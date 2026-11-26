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
  const rows = await computers(String((await orca.settings.get('orcaPath')) || ''), closing, report)
  const broken = rows.find(
    (c) => !c.unpaired && (!c.source.ok || c.warning || c.source.value.bots.some((b) => b.warning)),
  )
  if (broken) {
    data.sources.orca.status = 'failed'
    publish()
    await orca.host.call('statusBar.update', { id: 'needs-you', text: 'Needs you ?', tone: 'warning' })
    return
  }
  data.computers = rows
  data.itemsAt = Date.now()
  data.sources.orca = { status: 'fresh', at: data.itemsAt }
  publish()
  try {
    await saved.save('orca')
    await evaluateBells({ items: data.computers.flatMap((c) => (c.source.ok ? c.source.value.items : [])) })
    await avatar.prune(data.computers)
    const needsYou = rows
      .flatMap((c) => (c.source.ok ? c.source.value.items : []))
      .filter((i) => i.status === 'needs_you').length
    await orca.host.call('statusBar.update', { id: 'needs-you', text: 'Needs you ' + needsYou, tone: 'neutral' })
  } catch (error) {
    report(error)
  }
}
