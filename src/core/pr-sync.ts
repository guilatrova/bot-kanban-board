import type { PullRequest } from './model'

export const maxOpenPrs = 50
export interface SyncMetadata {
  syncedAt?: string
  login?: string
  allOpenLoaded?: boolean
}
export type SyncRow =
  | { state: 'OPEN' | 'CLOSED'; pr: PullRequest }
  | { state: 'MERGED'; pr: PullRequest; mergedAt: string }
