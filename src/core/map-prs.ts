import type { Item, Workspace, PullRequest, MappedPr, IssueRef } from './model'
export function githubRepo(url: string): string | null {
  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^/@\s?#]+@)?github\.com\/)([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    )
  return match?.[1] ?? null
}
export function repoMatch(a: string, b: string) {
  return a.toLowerCase() === (a.includes('/') ? b : b.split('/').pop())?.toLowerCase()
}
const referencePattern =
  /(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)|(?<![\w./-])([\w.-]+(?:\/[\w.-]+)?)#(\d+))\b/gi
export function linkedRepo(text: string, knownRepos: string[]) {
  for (const match of text.matchAll(referencePattern)) {
    const name = match[1] ?? match[4]
    const repo = name && knownRepos.find((repo) => repoMatch(name, repo))
    if (repo) return repo
  }
}
function mentions(text: string, ref: IssueRef, path: string) {
  for (const m of text.matchAll(referencePattern)) {
    const repo = m[1] ?? m[4]
    if (repo && repoMatch(repo, ref.repo) && (!m[2] || m[2] === path) && Number(m[3] ?? m[5]) === ref.number)
      return true
  }
  return false
}
export function owners(
  pr: IssueRef & Partial<Pick<PullRequest, 'head' | 'closes' | 'mentions'>>,
  items: Item[],
  workspaces: Workspace[],
) {
  const branches = workspaces.filter((w) => w.branch === pr.head && repoMatch(w.remote ?? w.repo, pr.repo))
  const direct = items.filter((i) => mentions(i.text, pr, 'pull'))
  const issues = [...(pr.closes ?? []), ...(pr.mentions ?? [])]
  const matches = direct.length ? direct : items.filter((i) => issues.some((r) => mentions(i.text, r, 'issues')))
  return {
    items: matches,
    workspaces: branches,
    how: direct.length
      ? ('item' as const)
      : matches.length
        ? ('issue' as const)
        : branches.length
          ? ('branch' as const)
          : null,
  }
}
export function mapPrs(prs: PullRequest[], items: Item[], workspaces: Workspace[]): MappedPr[] {
  return prs.map((pr) => ({ ...pr, ...owners(pr, items, workspaces) }))
}
