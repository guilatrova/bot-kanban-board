import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Computer } from '../core/model'
import { obj, rows } from '../core/normalize'
import { reader } from './sources/read'
export async function jump(
  orca: OrcaWorkerApi,
  computers: Computer[],
  path: string,
  input: { computer: string; bot: string; number?: number; workspace?: string },
) {
  const source = computers.find((c) => c.key === input.computer)?.source
  if (!source?.ok) throw Error('Computer unavailable. Refresh the board.')
  const bot = source.value.bots.find((b) => b.name === input.bot)
  if (!bot) throw Error('Bot unavailable. Refresh the board.')
  if (input.workspace) {
    const workspace = source.value.workspaces.find((w) => w.id === input.workspace && w.bot === bot.name)
    if (!workspace) throw Error('Workspace unavailable. Refresh the board.')
    await orca.host.call('workspace.open', { workspaceId: workspace.id })
    return 'Opened ' + workspace.name
  }
  const item = source.value.items.find((i) => i.bot === bot.name && i.number === input.number)
  try {
    const agents = await reader('orca', path)(['agent', 'list', '--environment', input.computer, '--json'], (v) =>
      rows(obj(v).agents)
        .map(obj)
        .filter((a) => typeof a.worktreeId === 'string' && a.worktreeId.startsWith('folder:')),
    )
    const row =
      agents.find((a) => item?.chatId && (a.orcaSessionId === item.chatId || a.sessionId === item.chatId)) ??
      agents.find((a) => a.workspace === bot.name && a.kind === 'chat')
    if (!row || typeof row.worktreeId !== 'string') throw Error('Folder unavailable')
    await orca.host.call('workspace.open', { workspaceId: row.worktreeId })
  } catch (error) {
    await promisify(execFile)(
      process.platform === 'darwin' ? 'open' : 'xdg-open',
      ['orca://bot/' + encodeURIComponent(bot.id)],
      { timeout: 10000 },
    )
    const reason = error instanceof Error ? error.message : String(error)
    return `Could not open the bot's workspace (${reason}). Opened the bot link instead. Switch to the bot in Orca's sidebar to answer.`
  }
  return 'Open ' + (item?.chat || 'the bot chat') + ' in Orca to answer.'
}
