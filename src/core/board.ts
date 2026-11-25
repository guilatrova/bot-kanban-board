import { botKey, isClosed, itemLane, itemLanes, type Computer, type PullRequest } from './model'
import { isToday, type MergedPr } from './merge'
import { stackOrder } from './stacks'
import { mapPrs, owners, repoMatch } from './map-prs'
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
  const allPrs = stackOrder(
    mapPrs(
      prs,
      items.filter((i) => !isClosed(i.status)),
      workspaces,
    ),
  )
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
  const columns = itemLanes.map((status) => ({
    status,
    items: items
      .filter(
        (i) => itemLane(i.status) === status && (status !== 'closed' || isToday(new Date(i.updated))) && itemVisible(i),
      )
      .sort((a, b) => (status === 'needs_you' ? a.updated - b.updated : b.updated - a.updated)),
  }))

  const mapped = allPrs.filter(
    (p) =>
      acceptsRepo(p.repo) &&
      (!view.needsMeOnly || !p.draft) &&
      ((p.how === null && selected.size !== 1) ||
        [...p.items, ...p.workspaces].some((m) => visible(m.computer, m.bot))),
  )
  const keys = (pr: Pick<(typeof allPrs)[number], 'items' | 'workspaces'>) =>
    new Set([...pr.items, ...pr.workspaces].map((m) => botKey(m.computer, m.bot)))
  const history = merged.map((pr) => ({ pr, keys: keys(owners(pr, items, workspaces)) }))
  const active = allPrs.map(keys)
  const roster = bots.map((b) => {
    const key = botKey(b.computer, b.name)
    const mine = items.filter((i) => i.computer === b.computer && i.bot === b.name)
    const count = mine.filter((i) => !isClosed(i.status)).length
    const cards = count + active.filter((set) => set.has(key)).length
    return {
      ...b,
      count,
      cards,
      chip:
        cards > 0 ||
        mine.some((i) => isClosed(i.status) && isToday(new Date(i.updated))) ||
        history.some((row) => row.keys.has(key) && isToday(new Date(row.pr.mergedAt))),
    }
  })
  return {
    columns,
    selected,
    merged: history
      .filter(
        ({ pr, keys }) =>
          !view.needsMeOnly && acceptsRepo(pr.repo) && (selected.size !== 1 || [...keys].some((k) => selected.has(k))),
      )
      .map((row) => row.pr),
    bots: roster,
    chips: roster.filter((b) => b.chip),
    computers: computers
      .filter((c) => !c.source.ok || c.source.value.bots.length || c.warning)
      .map((c) => ({
        key: c.key,
        name: c.name,
        warning: c.warning,
        unreachable: !c.source.ok || c.unpaired === true,
        error: c.source.ok ? null : c.source,
        count: items.filter((i) => !isClosed(i.status) && i.computer === c.key).length,
      })),
    ordered: mapped,
    ready: mapped.filter((p) => p.how && !p.draft),
    draft: mapped.filter((p) => p.how && p.draft),
    unmapped: mapped.filter((p) => !p.how),
  }
}
export type Board = ReturnType<typeof buildBoard>

export function toggleBot(selected: Set<string>, all: string[], key: string, solo: boolean) {
  if (solo) return selected.size === 1 && selected.has(key) ? new Set<string>() : new Set([key])
  const current = all.filter((id) => selected.has(id))
  const next = new Set(current.length ? current : all)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next.size === all.length ? new Set<string>() : next
}
