import { prKey, type PullRequest } from './model'

// Walk from each tip toward its base. A repeated branch ends the chain.
export function stackOrder<T extends PullRequest>(prs: T[]) {
  const parents = new Map(prs.map((pr) => [pr, prs.find((p) => p !== pr && p.repo === pr.repo && p.head === pr.base)]))
  const ordered = new Set<T>()
  for (const pr of prs) {
    const path = new Set<T>()
    let cursor: T | undefined = pr
    while (cursor && !ordered.has(cursor) && !path.has(cursor)) {
      path.add(cursor)
      cursor = parents.get(cursor)
    }
    for (const member of [...path].reverse()) ordered.add(member)
  }
  return [...ordered].map((pr) => {
    const parent = parents.get(pr)
    return { ...pr, behind: parent && prKey(parent) }
  })
}
