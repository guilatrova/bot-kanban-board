import type { PullRequest, IssueRef } from './model'

export const mergeMethods = ['squash', 'merge', 'rebase'] as const
export type MergeMethod = (typeof mergeMethods)[number]
export const methodLabels = { squash: 'Squash', merge: 'Merge commit', rebase: 'Rebase' }
export const shortMethodLabels = { ...methodLabels, merge: 'Merge' }
export type MergePreferences = {
  mergeMethod: MergeMethod
  botName: string
  computer: string
  mergedLimit: number
  compact: boolean
  tellBot: boolean
  askBeforeMerging: boolean
}
export function checksLabel(checks: string | null) {
  if (!checks) return ''
  if (checks === 'SUCCESS') return 'Checks passed'
  return ['FAILURE', 'ERROR'].includes(checks) ? 'Checks failed' : 'Checks running'
}
export function mergeableLabel(state: string) {
  if (state === 'MERGEABLE') return 'No conflicts'
  return state === 'CONFLICTING' ? 'Conflicts' : 'Checking for conflicts'
}
export type ConfirmedMerge = {
  warnings: Warning[]
  mergeable: string
  behind?: string
}
export function canMergeWithoutDialog(
  pr: PullRequest & { behind?: string },
  repo: RepositoryFacts,
  method: MergeMethod,
  confirmed?: ConfirmedMerge,
) {
  const assessment = assessMerge(pr, repo)
  return Boolean(
    pr.sha &&
      (pr.mergeable === 'MERGEABLE' || pr.mergeable === confirmed?.mergeable) &&
      (!pr.behind || pr.behind === confirmed?.behind) &&
      assessment.canMerge &&
      assessment.warnings.every((w) => confirmed?.warnings.some((previous) => previous.text === w.text)) &&
      assessment.methods.includes(method),
  )
}
export interface RepositoryFacts {
  defaultBranch: string
  push: boolean
  methods: MergeMethod[]
}
export interface Warning {
  text: string
  danger?: boolean
}
export const largeChangeLines = 5000

export function assessMerge(pr: PullRequest, repo: RepositoryFacts) {
  const blockers: string[] = [],
    warnings: Warning[] = []
  const methods = mergeMethods.filter((m) => repo.methods.includes(m))
  if (pr.mergeable === 'CONFLICTING') blockers.push('Resolve the conflicts on GitHub and refresh.')
  if (!repo.push) blockers.push('Push permission required. Ask a repository maintainer to merge.')
  if (!methods.length) blockers.push('No merge method is enabled. Contact a repository maintainer.')
  if (pr.draft) warnings.push({ text: 'Draft · It will be marked ready first.' })
  if (pr.base !== repo.defaultBranch)
    warnings.push({ text: 'Targets ' + pr.base + ' instead of ' + repo.defaultBranch + '.' })
  if (!pr.checks) warnings.push({ text: 'No checks ran.' })
  else if (pr.checks !== 'SUCCESS') warnings.push({ text: checksLabel(pr.checks) + '. Review the checks on GitHub.' })
  if (pr.additions + pr.deletions >= largeChangeLines)
    warnings.push({ text: 'Very large change. Review the diff before merging.' })
  if (/\b(?:do not merge|don['’]?t merge|not merge|wip|test only)\b|\[no merge\]/i.test(pr.title))
    warnings.push({ text: 'The title says not to merge. Verify the author’s intent before continuing.', danger: true })
  return { canMerge: !blockers.length, blockers, warnings, methods, defaultMethod: methods[0] }
}

export interface MergedPr extends IssueRef, Partial<Pick<PullRequest, 'head' | 'closes' | 'mentions'>> {
  title: string
  url: string
  mergedAt: string
}
export function localDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
export const isToday = (date: Date, now = new Date()) => localDate(date) === localDate(now)
export function mergedToday(prs: MergedPr[], now = new Date()) {
  return prs
    .filter((p) => isToday(new Date(p.mergedAt), now))
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
}

export function mergedLimit(value?: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(50, Math.max(1, Math.trunc(value))) : 10
}
export function shownMerges(prs: MergedPr[], limit?: number, now = new Date()) {
  return mergedToday(prs, now).slice(0, mergedLimit(limit))
}
