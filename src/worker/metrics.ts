import { AsyncLocalStorage } from 'node:async_hooks'
import type { OrcaWorkerApi, PanelRequestContext } from 'orca/worker'
import type { JsonValue } from 'orca'

const counters = () => ({
  messages: 0,
  storageReads: 0,
  storageWrites: 0,
  bytes: 0,
  orca: 0,
  github: 0,
  notModified: 0,
  graphql: 0,
  hits: 0,
  misses: 0,
})
type Counts = ReturnType<typeof counters>
type Operation = {
  kind: 'load' | 'refresh'
  counts: Counts
  active: number
  timer?: ReturnType<typeof setTimeout>
  panel?: string
  closed?: boolean
}
const scope = new AsyncLocalStorage<Operation>()
export function count(key: keyof Counts, value = 1) {
  const op = scope.getStore()
  if (op && !op.closed) op.counts[key] += value
}
function message(payload: unknown) {
  count('messages')
  count('bytes', Buffer.byteLength(JSON.stringify(payload ?? null)))
}
export function measure(orca: OrcaWorkerApi, write: (kind: string, fields: string[]) => void) {
  const loads = new Map<string, Operation>()
  const create = (kind: Operation['kind']): Operation => ({ kind, counts: counters(), active: 0 })
  async function run<T>(op: Operation, read: () => Promise<T>, panel?: string) {
    if (panel) op.panel = panel
    clearTimeout(op.timer)
    op.active++
    try {
      return await scope.run(op, read)
    } finally {
      if (--op.active === 0)
        op.timer = setTimeout(
          () => {
            op.closed = true
            if (op.panel && loads.get(op.panel) === op) loads.delete(op.panel)
            write(
              op.kind,
              Object.entries(op.counts).map(([k, v]) => k + '=' + v),
            )
          },
          op.kind === 'load' ? 2000 : 500,
        )
    }
  }
  function refresh<T>(job: () => Promise<T>) {
    const current = scope.getStore()
    return current && !current.closed ? run(current, job) : run(create('refresh'), job)
  }
  const panels: OrcaWorkerApi['panels'] = {
    handle: (name: string, handler: (input: JsonValue | undefined, ctx: PanelRequestContext) => unknown) =>
      orca.panels.handle(name, async (input, ctx) => {
        const id = ctx.panel.id
        const reply = async () => {
          if (input && typeof input === 'object' && !Array.isArray(input) && 'frameTraffic' in input) {
            const stats = input.frameTraffic
            if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
              for (const k of ['storageReads', 'storageWrites', 'bytes'] as const) {
                const n = stats[k]
                if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) {
                  count(k, n)
                  if (k !== 'bytes') count('messages', n)
                }
              }
            }
          }
          const result = await handler(input, ctx)
          message(result)
          return result
        }
        if (name === 'board.get' || name === 'avatars.get') {
          let op = loads.get(id)
          if (!op) {
            op = create('load')
            loads.set(id, op)
          }
          return run(op, reply, id)
        }
        if (name === 'board.visibility' && loads.has(id)) return run(loads.get(id)!, reply, id)
        if (name === 'board.refresh' || name === 'pr.merge' || name === 'pr.close') return refresh(reply)
        return reply()
      }),
    post: (event: string, payload?: JsonValue, options?: { panel?: string }) => {
      message(payload)
      orca.panels.post(event, payload, options)
    },
  }
  return { worker: { ...orca, panels }, refresh }
}
