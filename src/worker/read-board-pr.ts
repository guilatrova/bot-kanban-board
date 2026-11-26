import type { PluginRequests } from 'orca'
import type { Snapshot } from '../protocol'
import type { MergedPr } from '../core/merge'
import { prKey, type Failure } from '../core/model'
import { stackOrder } from '../core/stacks'
import { readRepository, readPull } from './sources/github'
import { source } from './sources/read'

export async function readBoardPr(
  ghPath: string,
  input: PluginRequests['pr.read']['input'],
  data: Snapshot,
  demo: boolean,
  refreshPrs: () => Promise<void | Failure>,
  recordMerged: (row: MergedPr) => void,
): Promise<PluginRequests['pr.read']['output']> {
  const { repo, number } = input
  const read = demo ? undefined : await source('gh api graphql', () => readPull(ghPath, { repo, number }))
  if (read && !read.ok) return read
  const live = read?.value
  if (live?.closed) return { closed: true as const, merged: false as const }
  if (live?.merged || (demo && data.merged.some((p) => prKey(p) === prKey(input)))) {
    if (live?.merged) recordMerged(live.row)
    return { merged: true as const }
  }
  if (input.prOnly && live?.pr) {
    const repository = await source('gh api repos', () => readRepository(ghPath, repo))
    if (!repository.ok) return repository
    data.repos[repo] = repository.value
    if (!repository.value.ok) return repository.value
    const index = data.prs.findIndex((p) => prKey(p) === prKey(input))
    if (index >= 0) data.prs[index] = live.pr
  } else if (!demo) {
    const failure = await refreshPrs()
    if (failure) return failure
  }
  const pr = live?.pr ?? data.prs.find((p) => prKey(p) === prKey(input))
  const facts = data.error || data.repos[input.repo]
  if (!pr || !facts)
    return {
      ok: false as const,
      command: 'PR read',
      message: !pr ? 'PR #' + number + ' not found on the board' : 'No repository data for ' + repo,
      next: 'Refresh the board and try again.',
    }
  const ordered = stackOrder([pr, ...data.prs.filter((p) => prKey(p) !== prKey(input))])
  return { merged: false as const, pr: ordered.find((p) => prKey(p) === prKey(input))!, facts }
}

export function readFailureToLog(result: PluginRequests['pr.read']['output']) {
  if ('ok' in result) return result.command === 'Refresh PRs' ? undefined : result
  if ('facts' in result && !result.facts.ok) return result.facts
}

export function refreshFailure(error: unknown, report: (error: unknown) => void): Failure {
  report(error)
  return {
    ok: false,
    command: 'Refresh PRs',
    message: error instanceof Error ? error.message : String(error),
    next: 'Refresh the board and try again.',
  }
}
