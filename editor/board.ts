import { view } from './render'
import { notice } from './dom'
import type { Snapshot } from '../src/protocol'
async function start() {
  const filter = await orca.storage.get('filter')
  const board = view(Array.isArray(filter) ? filter.filter((k): k is string => typeof k === 'string') : [])
  let chunks: string[] = []
  orca.plugin.on('board.changed', (chunk) => {
    if (chunk.index === 0) chunks = []
    chunks[chunk.index] = chunk.data
    if (chunk.index === chunk.count - 1) board.draw(JSON.parse(chunks.join('')) as Snapshot)
  })
  orca.plugin.on('board.focus', board.focus)
  await orca.plugin.request('board.get', undefined, { timeoutMs: 120000 })
}
void start().catch((e) => notice(String(e) + ' · Reopen the board to retry.'))
