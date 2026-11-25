import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import type { OrcaWorkerApi } from 'orca/worker'
import { reader } from './sources/read'
import { obj, str } from '../core/normalize'
export async function openBoard(orca: OrcaWorkerApi, path: string | null) {
  const root =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  const folder = join(root, 'bot-kanban-board'),
    file = 'Board.botkanban'
  await mkdir(folder, { recursive: true })
  try {
    await writeFile(join(folder, file), '{}\n', { flag: 'wx' })
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e
  }
  const projects = await orca.host.call('project.list')
  const project = projects.projects.find(
    (p) => p.kind === 'folder' && (!p.hostId || p.hostId === 'local') && p.path === folder,
  )
  let id = project?.id
  if (!id) {
    if (path === null)
      throw Error(
        'First-time demo setup: add the board folder as a folder project in Orca, then reopen the board. Folder: ' +
          folder,
      )
    id = await reader('orca', path)(['repo', 'add', '--kind', 'folder', '--path', folder, '--json'], (v) =>
      str(obj(obj(v).repo), 'id'),
    )
  }
  if (!project?.hidden) await orca.host.call('project.setHidden', { projectId: id, hidden: true })
  const trees = await orca.host.call('workspace.list')
  const workspace = trees.workspaces.find((w) => w.projectId === id && w.kind === 'folder')
  if (!workspace) throw Error('Board folder unavailable. Reopen the board from the command palette.')
  await orca.host.call('workspace.open', { workspaceId: workspace.id })
  await orca.host.call('editor.open', { workspaceId: workspace.id, path: file })
}
