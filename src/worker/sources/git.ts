import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { githubRepo } from '../../core/map-prs'
import type { Workspace } from '../../core/model'

const execute = promisify(execFile)
const remotes = new Map<string, Promise<string | null>>()

async function readRemote(path: string) {
  const git = async (...args: string[]) =>
    (await execute('git', ['-C', path, 'remote', ...args], { timeout: 5000 })).stdout.trim()
  try {
    return githubRepo(await git('get-url', 'origin'))
  } catch {
    const first = (await git()).split('\n')[0]
    return first ? githubRepo(await git('get-url', '--', first)) : null
  }
}

export async function workspaceRemote(workspace: Workspace): Promise<Workspace> {
  if (workspace.computer !== 'local' || !workspace.path) return workspace
  let remote = remotes.get(workspace.path)
  if (!remote) {
    remote = readRemote(workspace.path).catch(() => null)
    remotes.set(workspace.path, remote)
  }
  return { ...workspace, remote: await remote }
}
