import type { OrcaWorkerApi } from 'orca/worker'
import type { Snapshot } from '../protocol'
import type { avatars } from './avatars'
import type { notifications } from './bells'
import type { savedBoard } from './saved-board'
import { computers } from './sources/orca'
import { parseActions, moveState } from '../core/actions'

export async function refreshItemData(
  orca: OrcaWorkerApi,
  data: Snapshot,
  path: (key: string) => Promise<string>,
  saved: ReturnType<typeof savedBoard>,
  avatar: ReturnType<typeof avatars>,
  evaluateBells: Awaited<ReturnType<typeof notifications>>,
  publish: () => void,
) {
  const report = (error: unknown) => orca.log(String(error))
  const { moves } = parseActions(await orca.storage.get('actions'))
  const now = Date.now()
  const closing = new Set(
    Object.entries(moves)
      .filter(
        ([, move]) =>
          (move.target === 'done' || move.target === 'canceled') && moveState(move, undefined, now) === 'pending',
      )
      .map(([key]) => key),
  )
  for (const bell of data.bells ?? []) if (bell.kind === 'item') closing.add(bell.id)
  const rows = await computers(await path('orcaPath'), closing, report)
  data.computers = rows
  const hasCount = rows.some((c) => c.key !== 'discovery' && c.source.ok)
  if (hasCount) {
    data.itemsAt = Date.now()
    data.sources.orca = { status: 'fresh', at: data.itemsAt }
  } else data.sources.orca = { ...data.sources.orca, status: 'failed' }
  publish()
  try {
    const items = rows.flatMap((c) => (c.source.ok ? c.source.value.items : []))
    if (hasCount) {
      await saved.save('orca')
      await evaluateBells({ items })
      await avatar.prune(rows)
    }
  } catch (error) {
    report(error)
  }
}

export function watchItems(
  orca: OrcaWorkerApi,
  data: Snapshot,
  visible: () => boolean,
  interval: () => number,
  update: (kind: 'items' | 'trees', environment?: string, bot?: string) => Promise<void>,
  report: (error: unknown) => void,
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  function schedule(kind: 'items' | 'trees', workspace?: string | null, session?: string, title?: string) {
    const matches = data.computers.flatMap((c) => {
      if (!c.source.ok) return []
      const { items, workspaces, bots } = c.source.value
      const bot =
        items.find((i) => session && i.chatId === session)?.bot ??
        workspaces.find((w) => workspace && w.id === workspace)?.bot ??
        bots.find((b) => title === b.name)?.name
      return bot ? [{ environment: c.key, bot }] : []
    })
    const target = matches.length === 1 ? matches[0] : undefined
    const key = JSON.stringify([kind, target])
    if (timers.has(key)) return
    timers.set(
      key,
      setTimeout(
        () => {
          timers.delete(key)
          void update(kind, target?.environment, kind === 'items' ? target?.bot : undefined).catch(report)
        },
        target ? 100 : 2000,
      ),
    )
  }
  orca.events.on('agent.status.changed', (e) =>
    schedule('items', e.workspaceListId ?? e.workspaceId, e.sessionId, e.title),
  )
  orca.events.on('workspace.changed', (e) => schedule('items', e.context?.workspaceId))
  for (const name of ['workspace.created', 'workspace.removed'] as const)
    orca.events.on(name, (e) => schedule('trees', e.workspaceListId ?? e.workspaceId))
  async function tick() {
    try {
      if (visible()) await update('items')
    } catch (error) {
      report(error)
    } finally {
      setTimeout(() => void tick(), Math.max(30, interval()) * 1000)
    }
  }
  setTimeout(() => void tick(), Math.max(30, interval()) * 1000)
}
