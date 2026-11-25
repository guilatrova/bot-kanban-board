import { readViews } from './views'
import { readActions } from './item-actions'
import { view } from './render'
import { notice } from './dom'
import type { Snapshot } from '../src/protocol'
async function start() {
  const saved = await readViews()
  let board: Promise<ReturnType<typeof view>> | undefined
  let chunks: string[] = []
  orca.plugin.on('board.changed', (chunk) => {
    if (chunk.index === 0) chunks = []
    chunks[chunk.index] = chunk.data
    if (chunk.index === chunk.count - 1) {
      const data = JSON.parse(chunks.join('')) as Snapshot
      board ??= readActions(Boolean(data.demo)).then((actions) => view(saved, actions))
      void board.then((b) => b.draw(data)).catch(notice)
    }
  })
  orca.plugin.on('board.focus', () => void board?.then((b) => b.focus()))
  await orca.plugin.request('board.get', undefined, { timeoutMs: 120000 })
}
void start().catch((e) => notice(String(e) + ' · Reopen the board to retry.'))
