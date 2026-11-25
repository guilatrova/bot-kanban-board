import { botKey, statuses, type Computer, type PullRequest } from './model'
import { mapPrs } from './map-prs'
export function buildBoard(computers: Computer[], prs: PullRequest[], filter: string[]) {
  const sources = computers.flatMap((c) => (c.source.ok ? [c.source.value] : []))
  const bots = sources.flatMap((s) => s.bots),
    items = sources.flatMap((s) => s.items)
  const selected = new Set(filter.filter((k) => bots.some((b) => botKey(b.computer, b.name) === k)))
  const visible = (c: string, b: string) => !selected.size || selected.has(botKey(c, b))
  const columns = statuses
    .map((status) => ({
      status,
      items: items
        .filter((i) => i.status === status && visible(i.computer, i.bot))
        .sort((a, b) => (status === 'needs_you' ? a.updated - b.updated : b.updated - a.updated)),
    }))
    .filter((c) => c.status !== 'planned' || c.items.length)
  const mapped = mapPrs(
    prs,
    items,
    sources.flatMap((s) => s.workspaces),
  ).filter((p) =>
    p.how === null ? !selected.size : [...p.items, ...p.workspaces].some((m) => visible(m.computer, m.bot)),
  )
  return {
    columns,
    bots: bots.map((b) => ({ ...b, count: items.filter((i) => i.bot === b.name && i.computer === b.computer).length })),
    computers: computers.map((c) => ({
      key: c.key,
      name: c.name,
      error: c.source.ok ? null : c.source,
      count: items.filter((i) => i.computer === c.key).length,
    })),
    ready: mapped.filter((p) => p.how && !p.draft),
    draft: mapped.filter((p) => p.how && p.draft),
    unmapped: mapped.filter((p) => !p.how),
  }
}
export type Board = ReturnType<typeof buildBoard>

export function toggleBot(selected: Set<string>, all: string[], key: string, solo: boolean) {
  if (solo) return new Set([key])
  const current = all.filter((id) => selected.has(id))
  const next = new Set(current.length ? current : all)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next.size === all.length ? new Set<string>() : next
}
