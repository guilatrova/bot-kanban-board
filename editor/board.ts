import { readViews } from './views'
import { readActions } from './item-actions'
import { view } from './render'
import { notice, el } from './dom'
import type { Snapshot } from '../src/protocol'
async function start() {
  const loading = el('p', 'Reading board…', 'message')
  document.body.append(loading)
  let board: Promise<ReturnType<typeof view>> | undefined
  let latest: Snapshot
  const roster = async () => {
    await initialRead
    return latest.computers.flatMap((c) => (c.source.ok ? c.source.value.bots : []))
  }
  let chunks: string[] = []
  orca.plugin.on('board.changed', (chunk) => {
    if (chunk.index === 0) chunks = []
    chunks[chunk.index] = chunk.data
    if (chunk.index === chunk.count - 1) {
      const data = JSON.parse(chunks.join('')) as Snapshot
      latest = data
      board ??= Promise.all([
        readViews(Boolean(data.demo), roster),
        readActions(Boolean(data.demo)),
        orca.storage.get('collapsed'),
      ]).then(([saved, actions, collapsed]) => {
        loading.remove()
        return view(
          saved,
          actions,
          new Set<string>(
            Array.isArray(collapsed)
              ? collapsed.filter((k): k is string => typeof k === 'string')
              : ['waiting', 'closed'],
          ),
        )
      })
      void board.then((b) => b.draw(data)).catch(notice)
    }
  })
  orca.plugin.on('board.focus', () => void board?.then((b) => b.focus()))
  const initialRead = orca.plugin.request('board.get', undefined, { timeoutMs: 120000 })
  await initialRead
}
void start().catch((e) => notice(String(e) + ' · Reopen the board to retry.'))
