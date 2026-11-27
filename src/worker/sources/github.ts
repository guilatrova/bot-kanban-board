import { type SyncRow } from '../../core/pr-sync'
import { mergedToday, mergeMethods, type RepositoryFacts } from '../../core/merge'
import type { MergeInput, Progress } from '../../protocol'
import { prKey, type PullRequest, type Source } from '../../core/model'
import { runCli } from '../cli'
import { obj, rows, str, num, pullRequest, fileChange } from '../../core/normalize'
import { reader, source } from './read'
const pullFields = `number title url isDraft isCrossRepository headRefOid baseRefOid headRefName baseRefName body updatedAt additions deletions changedFiles mergeable repository{nameWithOwner} closingIssuesReferences(first:10){nodes{number repository{nameWithOwner}}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}`
const stateFields = 'state mergedAt ' + pullFields
const logins = new Map<string, string>()
export async function readRepository(path: string, repo: string) {
  const read = reader('gh', path)
  const result = await source('gh api repos', () =>
    read(['api', 'repos/' + repo], (v) => {
      const info = obj(v)
      return {
        defaultBranch: str(info, 'default_branch'),
        push: obj(info.permissions).push === true,
        methods: mergeMethods.filter(
          (m) =>
            info[{ squash: 'allow_squash_merge', merge: 'allow_merge_commit', rebase: 'allow_rebase_merge' }[m]] ===
            true,
        ),
      }
    }),
  )
  return result
}
function syncRow(value: unknown): SyncRow {
  const raw = obj(value)
  const state = raw.state
  if (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED') throw Error('Unknown pull request state.')
  const pr = pullRequest(raw)
  return state === 'MERGED' ? { state, pr, mergedAt: str(raw, 'mergedAt') } : { state, pr }
}
const repoFields =
  'nameWithOwner defaultBranchRef{name} viewerPermission squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed'
const searchFields = stateFields.replace('repository{nameWithOwner}', 'repository{' + repoFields + '}')

export function github(path: string, now: Date) {
  const read = reader('gh', path)
  return source('gh api graphql', async () => {
    const login = logins.get(path) ?? (await read(['api', 'user'], (v) => str(obj(v), 'login')))
    logins.set(path, login)
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const searches = { open: 'is:open', merged: 'is:merged merged:>=' + midnight }
    const cursors = new Map<string, string | null>([
      ['open', null],
      ['merged', null],
    ])
    const prs: PullRequest[] = []
    const merged: import('../../core/merge').MergedPr[] = []
    const repos: Record<string, Source<RepositoryFacts>> = {}
    let total = 0
    while (cursors.size) {
      const fields = Array.from(cursors, ([alias, cursor]) => {
        const search = 'is:pr user:' + login + ' ' + searches[alias as keyof typeof searches] + ' sort:updated-desc'
        return (
          alias +
          ':search(query:' +
          JSON.stringify(search) +
          ',type:ISSUE,first:100,after:' +
          JSON.stringify(cursor) +
          '){issueCount pageInfo{endCursor hasNextPage} nodes{...Pull}}'
        )
      })
      const query = 'query {' + fields.join(' ') + '} fragment Pull on PullRequest {' + searchFields + '}'
      const data = await read(['api', 'graphql', '-f', 'query=' + query], (value) => obj(obj(value).data))
      for (const alias of [...cursors.keys()]) {
        const page = obj(data[alias])
        if (alias === 'open') total = num(page, 'issueCount')
        for (const value of rows(page.nodes)) {
          const row = syncRow(value)
          if (row.state === 'MERGED') merged.push({ ...row.pr, mergedAt: row.mergedAt })
          if (row.state !== 'OPEN') continue
          prs.push(row.pr)
          const r = obj(obj(value).repository)
          repos[row.pr.repo] = {
            ok: true,
            value: {
              defaultBranch: str(obj(r.defaultBranchRef), 'name'),
              push: ['ADMIN', 'MAINTAIN', 'WRITE'].includes(String(r.viewerPermission)),
              methods: mergeMethods.filter(
                (m) =>
                  r[{ merge: 'mergeCommitAllowed', squash: 'squashMergeAllowed', rebase: 'rebaseMergeAllowed' }[m]] ===
                  true,
              ),
            },
          }
        }
        const info = obj(page.pageInfo)
        if (info.hasNextPage) cursors.set(alias, str(info, 'endCursor'))
        else cursors.delete(alias)
      }
    }
    const syncedAt = now.toISOString()
    return {
      login,
      syncedAt,
      fullSyncedAt: syncedAt,
      prs,
      total,
      repos,
      merged: { ok: true as const, value: mergedToday(merged, now) },
      allOpenLoaded: prs.length === total,
    }
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

export function closePr(path: string, pr: PullRequest) {
  return source('gh api pulls', () =>
    reader('gh', path)(
      ['api', '--method', 'PATCH', `repos/${pr.repo}/pulls/${pr.number}`, '-f', 'state=closed'],
      (value) => {
        if (obj(value).state !== 'closed') throw Error('GitHub did not confirm the close.')
        return null
      },
    ),
  )
}
export async function mergePr(
  path: string,
  pr: PullRequest,
  input: MergeInput,
  progress: (event: Progress) => void,
  onReady: () => void,
): Promise<Source<null>> {
  const key = prKey(pr)
  for (const step of (pr.draft ? ['ready', 'merge'] : ['merge']) as ('ready' | 'merge')[]) {
    progress({ key, step, state: 'running' })
    const result =
      step === 'ready'
        ? await runCli('gh', ['pr', 'ready', String(pr.number), '-R', pr.repo], path, 'text')
        : await runCli(
            'gh',
            [
              'api',
              '--method',
              'PUT',
              `repos/${pr.repo}/pulls/${pr.number}/merge`,
              '-f',
              'sha=' + input.sha,
              '-f',
              'merge_method=' + input.method,
            ],
            path,
          )
    if (!result.ok || (step === 'merge' && obj(result.value).merged !== true)) {
      const failure = result.ok
        ? {
            ok: false as const,
            command: 'gh api',
            message: String(obj(result.value).message || 'GitHub did not confirm the merge.'),
            next: '',
          }
        : result
      failure.next = 'Check the pull request and its rules, then merge it on GitHub.'
      progress({ key, step, state: 'failed', failure })
      return failure
    }
    if (step === 'ready') onReady()
    progress({ key, step, state: 'done' })
  }
  return { ok: true, value: null }
}

export function readPull(path: string, input: { repo: string; number: number }) {
  const [owner, name] = input.repo.split('/')
  return reader('gh', path)(
    [
      'api',
      'graphql',
      '-f',
      'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){' +
        stateFields +
        '}}}',
      '-f',
      'owner=' + owner,
      '-f',
      'name=' + name,
      '-F',
      'number=' + input.number,
    ],
    (value) => {
      const row = syncRow(obj(obj(obj(value).data).repository).pullRequest)
      if (row.state === 'MERGED') return { merged: true as const, row: { ...row.pr, mergedAt: row.mergedAt } }
      if (row.state === 'CLOSED') return { closed: true as const, merged: false as const }
      return { merged: false as const, pr: row.pr }
    },
  )
}
