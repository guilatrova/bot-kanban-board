import { checksFailed, checksLabel } from './merge'
import type { IssueRef, PullRequest } from './model'

export const countLabel = (count: number, noun: string) => numbers.format(count) + ' ' + noun + (count === 1 ? '' : 's')
const numbers = new Intl.NumberFormat('en-US')
export const shortRef = (pr: IssueRef) => pr.repo.split('/').at(-1) + '#' + pr.number
export function prStats(pr: Pick<PullRequest, 'additions' | 'deletions' | 'files' | 'checks'>) {
  return {
    diff:
      '+' + numbers.format(pr.additions) + ' −' + numbers.format(pr.deletions) + ' · ' + countLabel(pr.files, 'file'),
    check: checksLabel(pr.checks),
    failed: checksFailed(pr.checks),
  }
}
export function age(time: number | string, short = false, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(time).getTime()) / 60000))
  if (minutes < 1) return short ? '0m' : 'just now'
  const label =
    minutes < 60 ? minutes + 'm' : minutes < 1440 ? Math.floor(minutes / 60) + 'h' : Math.floor(minutes / 1440) + 'd'
  return short ? label : label + ' ago'
}
