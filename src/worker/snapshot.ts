import { preferenceKeys } from '../core/startup-preferences'
import { randomUUID } from 'node:crypto'
import type { OrcaWorkerApi } from 'orca/worker'
import { changes } from '../core/snapshot-diff'
import { responseBudget, pushBudget, type BoardReply, type Snapshot } from '../protocol'

export function serveSnapshots(orca: OrcaWorkerApi, data: Snapshot, opened: (id: string, visible: boolean) => void) {
  const epoch = randomUUID()
  let revision = 0
  let current = JSON.parse(JSON.stringify(data)) as Snapshot
  const history = new Map<number, Snapshot>()
  const pages = new Map<string, string[]>()
  function publish() {
    const next = JSON.parse(JSON.stringify(data)) as Snapshot
    const diff = changes(current, next)
    if (!Object.values(diff).some(Boolean)) return
    const baseRevision = revision++
    history.set(baseRevision, current)
    history.delete(baseRevision - 20)
    current = next
    const version = { epoch, revision, baseRevision }
    const push = JSON.parse(JSON.stringify({ ...version, changes: diff }))
    orca.panels.post(
      'board.changed',
      Buffer.byteLength(JSON.stringify(push)) > pushBudget ? { ...version, resync: true } : push,
    )
  }
  orca.panels.handle('board.get', async (input, ctx) => {
    const id = ctx.panel.id,
      index = input.index ?? 0
    if (!index) {
      if (input.fresh) opened(id, input.visible !== false)
      const base =
        input.epoch === epoch && input.revision !== undefined
          ? input.revision === revision
            ? current
            : history.get(input.revision)
          : undefined
      const reply: BoardReply = base
        ? { epoch, revision, kind: 'diff', changes: changes(base, current) }
        : { epoch, revision, kind: 'full', snapshot: current }
      if (input.fresh) {
        const keys = Object.values(preferenceKeys(Boolean(data.demo)))
        reply.preferences = Object.fromEntries(
          await Promise.all(keys.map(async (key) => [key, await orca.storage.get(key)])),
        )
      }
      const json = JSON.stringify(reply)
      if (Buffer.byteLength(json) < responseBudget) return JSON.parse(json) as BoardReply
      const parts: string[] = []
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
      pages.set(id, parts)
    }
    const parts = pages.get(id)
    if (!parts?.[index]) throw Error('Snapshot expired. Refresh the board.')
    if (index + 1 === parts.length) pages.delete(id)
    return { index, count: parts.length, data: parts[index]! }
  })
  return publish
}
