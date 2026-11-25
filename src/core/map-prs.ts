import type { Item, Workspace, PullRequest, MappedPr, IssueRef } from './model'
export function repoMatch(a: string, b: string) {
  return a.toLowerCase() === (a.includes('/') ? b : b.split('/').pop())?.toLowerCase()
}
function mentions(text: string, ref: IssueRef, path: string) {
  for (const m of text.matchAll(
    /(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)|(?<![\w./-])([\w.-]+(?:\/[\w.-]+)?)#(\d+))\b/gi,
  )) {
    const repo = m[1] ?? m[4]
    if (repo && repoMatch(repo, ref.repo) && (!m[2] || m[2] === path) && Number(m[3] ?? m[5]) === ref.number)
      return true
  }
  return false
}
export function mapPrs(prs: PullRequest[], items: Item[], workspaces: Workspace[]): MappedPr[] {
  return prs.map((pr) => {
    const branches = workspaces.filter((w) => w.branch === pr.head && repoMatch(w.repo, pr.repo))
    const direct = items.filter((i) => mentions(i.text, pr, 'pull'))
    const issues = [
      ...pr.closes,
      ...Array.from(pr.body.matchAll(/(?<![\w./-])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g), (m) => ({
        repo: m[1] ?? pr.repo,
        number: Number(m[2]),
      })),
    ]
    const matches = direct.length ? direct : items.filter((i) => issues.some((r) => mentions(i.text, r, 'issues')))
    return {
      ...pr,
      items: matches,
      workspaces: branches,
      how: direct.length ? 'item' : matches.length ? 'issue' : branches.length ? 'branch' : null,
    }
  })
}
