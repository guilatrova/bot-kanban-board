import { mergedToday, type MergedPr } from './merge'
import { prKey, type PullRequest } from './model'

export const FULL_SYNC_MS = 30 * 60_000
export interface SyncMetadata {
  syncedAt?: string
  fullSyncedAt?: string
  login?: string
  allOpenLoaded?: boolean
}
export function syncMode(state: SyncMetadata, { now, login, manual }: { now: Date; login: string; manual: boolean }) {
  if (manual || state.login !== login || !state.syncedAt || !state.fullSyncedAt) return 'full'
  return Number.isFinite(Date.parse(state.syncedAt)) && now.getTime() - Date.parse(state.fullSyncedAt) < FULL_SYNC_MS
    ? 'incremental'
    : 'full'
}
export type SyncRow =
  | { state: 'OPEN' | 'CLOSED'; pr: PullRequest }
  | { state: 'MERGED'; pr: PullRequest; mergedAt: string }
export function applyIncremental(
  state: { prs: PullRequest[]; merged: MergedPr[]; total: number; allOpenLoaded?: boolean },
  rows: SyncRow[],
  now: Date,
) {
  const open = new Map(state.prs.map((pr) => [prKey(pr), pr]))
  const merged = new Map(state.merged.map((pr) => [prKey(pr), pr]))
  for (const row of rows) {
    const { state, pr } = row
    const key = prKey(pr)
    if (state === 'OPEN') open.set(key, pr)
    else open.delete(key)
    if (state === 'MERGED') merged.set(key, { ...pr, mergedAt: row.mergedAt })
  }
  const prs = [...open.values()].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
  return {
    prs,
    merged: mergedToday([...merged.values()], now),
    total: state.allOpenLoaded ? prs.length : state.total + prs.length - state.prs.length,
  }
}
