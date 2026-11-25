import type { PullRequest, IssueRef } from './model'

export const manualBotNotification = 'The bot was not told; tell it in Orca'
export const mergeMethods = ['squash', 'merge', 'rebase'] as const
export type MergeMethod = (typeof mergeMethods)[number]
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
  else if (pr.checks !== 'SUCCESS') warnings.push({ text: 'Checks: ' + pr.checks + '. Review the checks on GitHub.' })
  if (pr.additions + pr.deletions >= largeChangeLines)
    warnings.push({ text: 'Very large change. Review the diff before merging.' })
  if (/\b(?:do not merge|don['’]?t merge|not merge|wip|test only)\b|\[no merge\]/i.test(pr.title))
    warnings.push({ text: 'The title says not to merge. Verify the author’s intent before continuing.', danger: true })
  return { canMerge: !blockers.length, blockers, warnings, methods, defaultMethod: methods[0] }
}

export interface MergedPr extends IssueRef {
  title: string
  url: string
  mergedAt: string
  notification?: string
}
export function localDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
export function mergedToday(prs: MergedPr[], now = new Date()) {
  return prs
    .filter((p) => localDate(new Date(p.mergedAt)) === localDate(now))
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
}
