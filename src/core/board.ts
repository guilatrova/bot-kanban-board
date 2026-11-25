import { botKey, statuses, type Computer, type PullRequest } from './model'
import type { MergedPr } from './merge'
import { stackOrder } from './stacks'
import { mapPrs, repoMatch } from './map-prs'
export type View = { name: string; bots: string[] | 'all'; repos: string[] | 'all'; needsMeOnly: boolean }
export const allView: View = { name: '', bots: 'all', repos: 'all', needsMeOnly: false }
export function selectedBots(filter: View['bots'], bots: { computer: string; name: string }[]) {
  const keys = new Set(bots.map((b) => botKey(b.computer, b.name)))
  return new Set(filter === 'all' ? [] : filter.filter((key) => keys.has(key)))
}
export function buildBoard(computers: Computer[], prs: PullRequest[], view: View, merged: MergedPr[] = []) {
  const sources = computers.flatMap((c) => (c.source.ok ? [c.source.value] : []))
  const bots = sources.flatMap((s) => s.bots),
    items = sources.flatMap((s) => s.items)
  const selected = selectedBots(view.bots, bots)
  const workspaces = sources.flatMap((s) => s.workspaces)
  const allPrs = stackOrder(mapPrs(prs, items, workspaces))
  const acceptsRepo = (repo: string) =>
    view.repos === 'all' || view.repos.some((r) => repoMatch(repo, r) || repoMatch(r, repo))
  function itemVisible(i: (typeof items)[number]) {
    if (!visible(i.computer, i.bot) || (view.needsMeOnly && i.status !== 'needs_you')) return false
    if (view.repos === 'all') return true
    const known = [
      ...allPrs.filter((p) => p.items.includes(i)).map((p) => p.repo),
      ...workspaces
        .filter(
          (w) =>
            w.computer === i.computer &&
            w.bot === i.bot &&
            i.workers.some((worker) => worker.workspace === w.id || worker.workspace === w.name),
        )
        .map((w) => w.repo),
    ]
    return !known.length || known.some(acceptsRepo)
  }
  const visible = (c: string, b: string) => !selected.size || selected.has(botKey(c, b))
  const columns = statuses
    .map((status) => ({
      status,
      items: items
        .filter((i) => i.status === status && itemVisible(i))
        .sort((a, b) => (status === 'needs_you' ? a.updated - b.updated : b.updated - a.updated)),
    }))
    .filter((c) => c.status !== 'planned' || c.items.length)
  const mapped = allPrs.filter(
    (p) =>
      acceptsRepo(p.repo) &&
      (!view.needsMeOnly || !p.draft) &&
      (p.how === null ? !selected.size : [...p.items, ...p.workspaces].some((m) => visible(m.computer, m.bot))),
  )
  return {
    columns,
    selected,
    merged: merged.filter((pr) => !view.needsMeOnly && !selected.size && acceptsRepo(pr.repo)),
    bots: bots.map((b) => ({ ...b, count: items.filter((i) => i.bot === b.name && i.computer === b.computer).length })),
    computers: computers.map((c) => ({
      key: c.key,
      name: c.name,
      error: c.source.ok ? null : c.source,
      count: items.filter((i) => i.computer === c.key).length,
    })),
    ordered: mapped,
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
