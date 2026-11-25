import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import type { OrcaWorkerApi } from 'orca/worker'
import { reader } from './sources/read'
import { obj, str } from '../core/normalize'
export async function openBoard(orca: OrcaWorkerApi, path: string) {
  const root =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  const folder = join(root, 'orca-bots-board'),
    file = 'Board.botsboard'
  await mkdir(folder, { recursive: true })
  try {
    await writeFile(join(folder, file), '{}\n', { flag: 'wx' })
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e
  }
  const projects = await orca.host.call('project.list')
  let id = projects.projects.find(
    (p) => p.kind === 'folder' && (!p.hostId || p.hostId === 'local') && p.path === folder,
  )?.id
  if (!id)
    id = await reader('orca', path)(['repo', 'add', '--kind', 'folder', '--path', folder, '--json'], (v) =>
      str(obj(obj(v).repo), 'id'),
    )
  await orca.host.call('project.setHidden', { projectId: id, hidden: true })
  const trees = await orca.host.call('workspace.list')
  const workspace = trees.workspaces.find((w) => w.projectId === id && w.kind === 'folder')
  if (!workspace) throw Error('Board folder unavailable. Reopen the board from the command palette.')
  await orca.host.call('editor.open', { workspaceId: workspace.id, path: file })
}

// Demo can open on a fresh install without registering a project through the CLI.
export async function openDemoBoard(orca: OrcaWorkerApi) {
  const focused = await orca.host.call('workspace.readContext')
  const { workspaces } = await orca.host.call('workspace.list')
  const workspace = workspaces.find((w) => w.id === focused?.workspaceId && (!w.hostId || w.hostId === 'local'))
  if (!workspace) throw Error('Open a local workspace to display the demo.')
  const folder = join('.orca', 'bots-board')
  const file = join(folder, 'Demo.botsboard')
  await mkdir(join(workspace.path, folder), { recursive: true })
  await writeFile(join(workspace.path, file), '', { flag: 'a' })
  await orca.host.call('editor.open', { workspaceId: workspace.id, path: file })
}
