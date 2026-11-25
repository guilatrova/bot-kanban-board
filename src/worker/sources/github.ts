import type { PullRequest } from '../../core/model'
import { obj, rows, str, num, pullRequest, fileChange } from '../../core/normalize'
import { reader, source } from './read'
export const query = `query($search:String!,$after:String){search(query:$search,type:ISSUE,first:40,after:$after){issueCount pageInfo{hasNextPage endCursor} nodes{... on PullRequest{ number title url isDraft headRefName baseRefName body updatedAt additions deletions changedFiles mergeable repository{nameWithOwner} closingIssuesReferences(first:10){nodes{number repository{nameWithOwner}}} commits(last:1){nodes{commit{statusCheckRollup{state}}}} }}}}`
export function github(path: string) {
  const read = reader('gh', path)
  return source('gh api graphql', async () => {
    const login = await read(['api', 'user'], (v) => str(obj(v), 'login'))
    const prs: PullRequest[] = []
    let total = 0,
      after = ''
    for (let page = 0; page < 5; page++) {
      const result = await read(
        [
          'api',
          'graphql',
          '-f',
          'query=' + query,
          '-f',
          'search=is:pr is:open user:' + login + ' sort:updated-desc',
          ...(after ? ['-f', 'after=' + after] : []),
        ],
        (v) => {
          const search = obj(obj(obj(v).data).search),
            info = obj(search.pageInfo)
          return {
            total: num(search, 'issueCount'),
            prs: rows(search.nodes).map(pullRequest),
            after: info.hasNextPage ? str(info, 'endCursor') : '',
          }
        },
      )
      prs.push(...result.prs)
      total = result.total
      after = result.after
      if (!after) break
    }
    return { prs, total }
  })
}
export function files(path: string, pr: PullRequest) {
  return source('gh api pulls/files', () =>
    reader('gh', path)(
      ['api', '--paginate', '--slurp', `repos/${pr.repo}/pulls/${pr.number}/files?per_page=100`],
      (v) => rows(v).flatMap((page) => rows(page).map(fileChange)),
    ),
  )
}
