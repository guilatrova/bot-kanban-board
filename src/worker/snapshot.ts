import { dedupe } from './dedupe'
import { preferenceKeys } from '../core/startup-preferences'
import { randomUUID } from 'node:crypto'
import type { OrcaWorkerApi } from 'orca/worker'
import { changes, applyChanges, type Changes } from '../core/snapshot-diff'
import { responseBudget, pushBudget, type BoardReply, type Snapshot } from '../protocol'

// Orca bounds the structured-clone walk as well as the size of its result.
function fits(value: unknown, budget: number) {
  let bytes = 0,
    objects = 0
  function visit(v: unknown, depth: number): void {
    if (bytes > budget) return
    if (v === null || typeof v === 'boolean') {
      bytes++
      return
    }
    if (typeof v === 'number') {
      bytes += 8
      return
    }
    if (typeof v === 'string') {
      bytes += Buffer.byteLength(v)
      return
    }
    if (!v || typeof v !== 'object') return
    if (++objects > 10000 || depth > 100) {
      bytes = budget + 1
      return
    }
    if (Array.isArray(v)) {
      bytes += 8 + 4 * v.length
      for (const entry of v) visit(entry, depth + 1)
    } else
      for (const [key, entry] of Object.entries(v)) {
        bytes += 4 + Buffer.byteLength(key)
        visit(entry, depth + 1)
      }
  }
  visit(value, 0)
  return bytes <= budget
}
export function serveSnapshots(
  orca: OrcaWorkerApi,
  data: Snapshot,
  opened: (id: string, visible: boolean) => Promise<void>,
  visibilityChanged: (id: string, visible: boolean) => Promise<void>,
) {
  const epoch = randomUUID()
  let hasReader = false
  let revision = 0
  let current = JSON.parse(JSON.stringify(data)) as Snapshot
  const history = new Map<number, Changes>()
  const pages = new Map<string, string[]>()
  orca.panels.handle('board.visibility', async ({ visible }, { panel }) => {
    if (!visible) pages.delete(panel.id)
    await visibilityChanged(panel.id, visible)
    return null
  })
  function publish() {
    const next = JSON.parse(JSON.stringify(data)) as Snapshot
    const diff = changes(current, next)
    if (!Object.values(diff).some(Boolean)) return
    const baseRevision = revision++
    history.set(baseRevision, changes(next, current))
    history.delete(baseRevision - 20)
    current = next
    if (!hasReader) return
    const version = { epoch, revision, baseRevision }
    const push = JSON.parse(JSON.stringify({ ...version, changes: diff }))
    orca.panels.post(
      'board.changed',
      !fits(push, pushBudget) || Buffer.byteLength(JSON.stringify(push)) > pushBudget
        ? { ...version, resync: true }
        : push,
    )
  }
  orca.panels.handle('board.get', async (input, ctx) => {
    const id = ctx.panel.id,
      index = input.index ?? 0
    if (!index) {
      const parts: string[] = []
      pages.set(id, parts)
      try {
        if (input.fresh) await opened(id, input.visible !== false)
        publish()
        hasReader = true
        let base: Snapshot | undefined
        if (
          input.epoch === epoch &&
          input.revision !== undefined &&
          (input.revision === revision || history.has(input.revision))
        ) {
          base = current
          for (let i = revision - 1; i >= input.revision; i--) base = applyChanges(base, history.get(i)!)
        }
        const reply: BoardReply = base
          ? { epoch, revision, kind: 'diff', changes: changes(base, current) }
          : { epoch, revision, kind: 'full', snapshot: current }
        if (input.fresh) {
          const keys = Object.values(preferenceKeys(Boolean(data.demo)))
          reply.preferences = Object.fromEntries(
            await Promise.all(
              keys.map(async (key) => [key, await dedupe('startup:' + key, () => orca.storage.get(key))]),
            ),
          )
        }
        const json = JSON.stringify(reply)
        if (Buffer.byteLength(json) < responseBudget && fits(reply, responseBudget))
          return JSON.parse(json) as BoardReply
        if (pages.get(id) !== parts) throw Error('Snapshot expired. Refresh the board.')
        let part = '',
          size = 0
        for (const char of json) {
          const bytes = Buffer.byteLength(JSON.stringify(char)) - 2
          if (size + bytes > responseBudget - 128) {
            parts.push(part)
            part = ''
            size = 0
          }
          part += char
          size += bytes
        }
        parts.push(part)
      } finally {
        if (!parts.length && pages.get(id) === parts) pages.delete(id)
      }
    }
    const parts = pages.get(id)
    if (!parts?.[index]) throw Error('Snapshot expired. Refresh the board.')
    if (index + 1 === parts.length) pages.delete(id)
    return { index, count: parts.length, data: parts[index]! }
  })
  return publish
}
