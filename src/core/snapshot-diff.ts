import type { Snapshot } from '../protocol'
import { itemKey, prKey, type Computer, type Item, type PullRequest } from './model'
import type { MergedPr } from './merge'

type Rows<T> = { upsert: T[]; remove: string[]; order?: string[] }
type Header = Omit<Snapshot, 'computers' | 'prs' | 'merged'>
export type Changes = {
  header?: Partial<Header>
  computers?: Rows<Computer>
  items?: Rows<Item>
  prs?: Rows<PullRequest>
  merged?: Rows<MergedPr>
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const computerKey = (c: Computer) => c.key
function split({ computers, prs, merged, ...header }: Snapshot) {
  const items: Item[] = []
  const columns = computers.map((c) => {
    if (!c.source.ok) return c
    items.push(...c.source.value.items)
    return { ...c, source: { ok: true as const, value: { ...c.source.value, items: [] } } }
  })
  return { header, items, computers: columns, prs, merged }
}
function compare<T>(before: T[], after: T[], key: (row: T) => string): Rows<T> | undefined {
  const old = new Map(before.map((row) => [key(row), row]))
  const keys = after.map(key)
  const next = new Set(keys)
  const remove = [...old.keys()].filter((k) => !next.has(k))
  const upsert = after.filter((row) => !same(row, old.get(key(row))))
  const order = same(keys, [...old.keys()].filter((k) => next.has(k)).concat(keys.filter((k) => !old.has(k))))
    ? undefined
    : keys
  return upsert.length || remove.length || order ? { upsert, remove, ...(order ? { order } : {}) } : undefined
}
export function changes(before: Snapshot, after: Snapshot): Changes {
  const a = split(before),
    b = split(after)
  const header = Object.fromEntries(Object.entries(b.header).filter(([k, v]) => !same(a.header[k as keyof Header], v)))
  return {
    header: Object.keys(header).length ? header : undefined,
    computers: compare(a.computers, b.computers, computerKey),
    items: compare(a.items, b.items, itemKey),
    prs: compare(a.prs, b.prs, prKey),
    merged: compare(a.merged, b.merged, prKey),
  }
}
function apply<T>(rows: T[], diff: Rows<T> | undefined, key: (row: T) => string) {
  if (!diff) return rows
  const map = new Map(rows.map((row) => [key(row), row]))
  for (const id of diff.remove) map.delete(id)
  for (const row of diff.upsert) map.set(key(row), row)
  return diff.order ? diff.order.map((k) => map.get(k)!) : [...map.values()]
}
export function applyChanges(snapshot: Snapshot, diff: Changes): Snapshot {
  const base = split(snapshot)
  const items = apply(base.items, diff.items, itemKey)
  const computers = apply(base.computers, diff.computers, computerKey).map((c) =>
    c.source.ok
      ? {
          ...c,
          source: { ok: true as const, value: { ...c.source.value, items: items.filter((i) => i.computer === c.key) } },
        }
      : c,
  )
  return {
    ...base.header,
    ...diff.header,
    computers,
    prs: apply(base.prs, diff.prs, prKey),
    merged: apply(base.merged, diff.merged, prKey),
  }
}
