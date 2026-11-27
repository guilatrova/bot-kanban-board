import { isAsleep } from './actions'
import {
  type Item,
  type MappedPr,
  botKey,
  isClosed,
  itemLane,
  itemLanes,
  type Computer,
  type PullRequest,
} from './model'
import { isToday, type MergedPr } from './merge'
import { stackOrder } from './stacks'
import { mapPrs, owners, linkedRepo } from './map-prs'
export type View = { name: string; bots: string[] | 'all'; repos: string[] | 'all'; needsMeOnly: boolean }
export const allView: View = { name: '', bots: 'all', repos: 'all', needsMeOnly: false }
export function selectedBots(filter: View['bots'], bots: { computer: string; name: string }[]) {
  const keys = new Set(bots.map((b) => botKey(b.computer, b.name)))
  return new Set(filter === 'all' ? [] : filter.filter((key) => keys.has(key)))
}
export const noRepo = 'No repo'
export function cardRepo(item: Item, mapped: MappedPr[], knownRepos: string[]) {
  return mapped.find((p) => p.items.includes(item))?.repo ?? linkedRepo(item.text, knownRepos) ?? noRepo
}
export function buildBoard(
  computers: Computer[],
  prs: PullRequest[],
  view: View,
  merged: MergedPr[] = [],
  sleeps: Record<string, number> = {},
  now = Date.now(),
) {
  const sources = computers.flatMap((c) => (c.source.ok ? [c.source.value] : []))
  const rosterBots = sources.flatMap((s) => s.bots)
  const bots = rosterBots.filter((b) => !b.paused)
  const paused = new Set(rosterBots.filter((b) => b.paused).map((b) => botKey(b.computer, b.name)))
  const awake = (owner: { computer: string; bot: string }) => !paused.has(botKey(owner.computer, owner.bot))
  const rawItems = sources.flatMap((s) => s.items)
  const items = rawItems.filter(awake)
  const workspaces = sources.flatMap((s) => s.workspaces)
  const selected = selectedBots(view.bots, bots)
  const ownedByActive = (row: ReturnType<typeof owners>) =>
    (!row.items.length && !row.workspaces.length) || [...row.items, ...row.workspaces].some(awake)
  const allPrs = stackOrder(
    mapPrs(
      prs,
      rawItems.filter((i) => !isClosed(i.status)),
      workspaces,
    )
      .filter(ownedByActive)
      .map((p) => ({ ...p, items: p.items.filter(awake), workspaces: p.workspaces.filter(awake) })),
  )
  const knownRepos = [
    ...new Set(
      [
        ...prs.map((pr) => pr.repo),
        ...merged.map((pr) => pr.repo),
        ...workspaces.map((w) => w.remote ?? w.repo),
      ].filter((repo) => repo.includes('/')),
    ),
  ]
  const repoOf = new Map(items.map((i) => [i, cardRepo(i, allPrs, knownRepos)]))
  const asleep = (i: Item) => isAsleep(i, sleeps, now)
  const eligible = items.filter((i) => !isClosed(i.status) || isToday(new Date(i.updated)))
  const keys = (pr: Pick<(typeof allPrs)[number], 'items' | 'workspaces'>) =>
    new Set([...pr.items, ...pr.workspaces].map((m) => botKey(m.computer, m.bot)))
  const history = merged
    .map((pr) => ({ pr, ownership: owners(pr, rawItems, workspaces) }))
    .filter((row) => ownedByActive(row.ownership))
    .map(({ pr, ownership }) => ({ pr, keys: keys(ownership) }))
  const repos = new Map<string, number>([[noRepo, 0]])
  for (const repo of [
    ...eligible.filter((i) => !asleep(i)).map((i) => repoOf.get(i)!),
    ...allPrs.map((p) => p.repo),
    ...history.map((h) => h.pr.repo),
  ])
    repos.set(repo, (repos.get(repo) ?? 0) + 1)
  const selectedRepos = new Set(view.repos === 'all' ? [] : view.repos.filter((repo) => repos.has(repo)))
  const reposFiltered =
    (view.repos !== 'all' && view.repos.length === 0) || (selectedRepos.size > 0 && selectedRepos.size < repos.size)
  const acceptsRepo = (repo: string) => !reposFiltered || selectedRepos.has(repo)
  const visible = (c: string, b: string) => !selected.size || selected.has(botKey(c, b))
  const itemVisible = (i: Item) =>
    visible(i.computer, i.bot) && (!view.needsMeOnly || i.status === 'needs_you') && acceptsRepo(repoOf.get(i)!)
  const sleeping = eligible.filter((i) => itemVisible(i) && asleep(i))
  const columns = itemLanes.map((status) => ({
    status,
    items: eligible
      .filter((i) => itemLane(i.status) === status && itemVisible(i) && !asleep(i))
      .sort((a, b) => (status === 'needs_you' ? a.updated - b.updated : b.updated - a.updated)),
  }))

  const mapped = allPrs.filter(
    (p) =>
      acceptsRepo(p.repo) &&
      (!view.needsMeOnly || !p.draft) &&
      ((p.how === null && selected.size !== 1) ||
        [...p.items, ...p.workspaces].some((m) => visible(m.computer, m.bot))),
  )
  const active = allPrs.filter((p) => acceptsRepo(p.repo)).map(keys)
  const roster = bots.map((b) => {
    const key = botKey(b.computer, b.name)
    const mine = items.filter((i) => i.computer === b.computer && i.bot === b.name)
    const count = mine.filter((i) => !isClosed(i.status) && acceptsRepo(repoOf.get(i)!)).length
    const cards = count + active.filter((set) => set.has(key)).length
    return {
      ...b,
      count,
      cards,
      chip:
        mine.some((i) => !isClosed(i.status)) ||
        allPrs.some((p) => keys(p).has(key)) ||
        mine.some((i) => isClosed(i.status) && isToday(new Date(i.updated))) ||
        history.some((row) => row.keys.has(key) && isToday(new Date(row.pr.mergedAt))),
    }
  })
  return {
    columns,
    sleeping,
    repos,
    acceptsRepo,
    reposFiltered,
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

export function toggleSelection(selected: Set<string>, all: string[], key: string, solo: boolean) {
  if (solo) return selected.size === 1 && selected.has(key) ? new Set<string>() : new Set([key])
  const current = all.filter((id) => selected.has(id))
  const next = new Set(current.length ? current : all)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next.size === all.length ? new Set<string>() : next
}
