import type { PullRequest } from '../src/core/model'
import { checksLabel } from '../src/core/merge'
export const countLabel = (count: number, noun: string) => count + ' ' + noun + (count === 1 ? '' : 's')

export const prStats = (pr: PullRequest) =>
  ['+' + pr.additions + ' −' + pr.deletions, countLabel(pr.files, 'file'), checksLabel(pr.checks)].join(' · ')
