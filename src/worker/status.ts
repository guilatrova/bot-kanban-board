import { itemKey } from '../core/model'
import type { OrcaWorkerApi } from 'orca/worker'
import { buildBoard } from '../core/board'
import { storedViews } from '../core/views'
import { parseActions } from '../core/actions'
import type { Snapshot } from '../protocol'

export async function boardStatus(
  orca: OrcaWorkerApi,
  data: Snapshot,
  demo: boolean,
  report: (error: unknown) => void,
) {
  const readView = () =>
    storedViews(orca.storage, demo, async () => data.computers.flatMap((c) => (c.source.ok ? c.source.value.bots : [])))
  const actionsKey = demo ? 'demo-actions' : 'actions'
  const viewsKey = demo ? 'demo-views' : 'views'
  let view = await readView()
  let actions = parseActions(await orca.storage.get(actionsKey))
  let pending = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  function update() {
    clearTimeout(timer)
    const now = Date.now()
    const board = buildBoard(data.computers, data.prs, view.current, data.merged, actions.sleeps, now)
    const count = board.columns.find((c) => c.status === 'needs_you')!.items.length
    const hasCount = data.computers.some((c) => c.key !== 'discovery' && c.source.ok)
    const unreachable = data.computers.filter((c) => !c.source.ok).length
    const text = hasCount
      ? 'Needs you ' + count + (unreachable ? ' · ' + unreachable + ' unreachable' : '')
      : 'Needs you ?'
    pending = pending
      .then(async () => {
        await orca.host.call('statusBar.update', {
          id: 'needs-you',
          text,
          tone: hasCount ? (unreachable ? 'warning' : 'neutral') : 'danger',
        })
      })
      .catch(report)
    const ends = board.sleeping
      .flatMap((i) => [i.snoozedUntil ?? 0, actions.sleeps[itemKey(i)] ?? 0])
      .filter((end) => end > now)
    if (ends.length) timer = setTimeout(update, Math.min(2147483647, Math.min(...ends) - now))
  }
  let changes = Promise.resolve()
  orca.storage.onDidChange(({ key }) => {
    if (key !== viewsKey && key !== actionsKey) return
    changes = changes
      .then(async () => {
        if (key === viewsKey) view = await readView()
        else actions = parseActions(await orca.storage.get(actionsKey))
        update()
      })
      .catch(report)
  })
  update()
  return update
}
