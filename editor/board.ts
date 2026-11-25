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
  async function read(fresh = false) {
    const chunks: string[] = []
    for (let index = 0; ; index++) {
      const chunk = await orca.plugin.request('board.get', { index, fresh }, { timeoutMs: 120000 })
      chunks.push(chunk.data)
      if (index + 1 === chunk.count) break
    }
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
  let dirty = false
  let reading = true
  async function drain() {
    try {
      while (dirty) {
        dirty = false
        await read()
      }
    } finally {
      reading = false
    }
  }
  orca.plugin.on('board.changed', () => {
    dirty = true
    if (!reading) {
      reading = true
      void drain().catch(notice)
    }
  })
  orca.plugin.on('board.focus', () => void board?.then((b) => b.focus()))
  const initialRead = read(true).finally(drain)
  await initialRead
}
void start().catch((e) => notice(String(e) + ' · Reopen the board to retry.'))
