import type { MergedPr, MergeMethod, RepositoryFacts } from './core/merge'
export interface BotMessage {
  computer: string
  botName: string
  subject: string
  body: string
}
export interface MergeInput {
  bulk?: boolean
  prOnly?: boolean
  repo: string
  number: number
  updated: string
  sha: string
  method: MergeMethod
}
export interface Progress {
  key: string
  step: 'ready' | 'merge'
  state: 'running' | 'done' | 'failed'
  failure?: Failure
}
import type { Computer, Failure, PullRequest, Source, SourceState } from './core/model'
import type { Bell } from './core/bells'
import type { SyncMetadata } from './core/pr-sync'
export interface Snapshot extends SyncMetadata {
  sources: { orca: SourceState; github: SourceState }
  bells?: Bell[]
  notificationsOff?: boolean
  demo?: boolean
  computers: Computer[]
  prs: PullRequest[]
  repos: Record<string, Source<RepositoryFacts>>
  merged: MergedPr[]
  banner: string | null
  total: number
  itemsAt: number
  prsAt: number
  error: Failure | null
  running?: string[]
  focus: boolean
}
// Orca maps uncoded exceptions from our worker handlers to action_failed.
export const workerRejectionCodes: ReadonlySet<string> = new Set(['action_failed'])
export type PanelRejection = {
  method: string
  name: string | null
  code: string | null
  message: string
  retryable: boolean | null
  stack: string | null
  calls: string[]
}
export type Chunk = { index: number; count: number; data: string }
declare module 'orca' {
  interface PluginRequests {
    'panel.failure': { input: PanelRejection; output: null }
    'storage.failure': { input: { key: string; valueBytes: number; error: string }; output: null }
    'bot.tell': { input: BotMessage; output: boolean }
    'board.visibility': { input: { shown: boolean; initial?: boolean }; output: null }
    'board.get': { input: { index: number; fresh?: boolean }; output: Chunk }
    'pr.read': {
      input: { repo: string; number: number; prOnly?: boolean }
      output: Source<
        | { merged: false; closed: true }
        | { merged: true; closed?: false }
        | { merged: false; closed?: false; pr: PullRequest & { behind?: string }; facts: Source<RepositoryFacts> }
      >
    }
    'board.refresh': { input: undefined; output: null }
    'avatar.get': {
      input: { computer: string; bot: string; offset: number }
      output: { data: string; next: number | null } | null
    }
    'bell.set': { input: { bell: Bell; on: boolean }; output: null }
    'pr.close': { input: { repo: string; number: number }; output: Source<null> }
    'pr.merge': { input: MergeInput; output: Source<null> }
    'pr.files': {
      input: { key: string; updated: string; offset: number }
      output: Source<{ data: string; end: boolean }>
    }
    'board.jump': { input: { computer: string; bot: string; number?: number; workspace?: string }; output: string }
  }
  interface PluginPanelEvents {
    'board.changed': null
    'merge.progress': Progress
    'board.focus': null
  }
}
