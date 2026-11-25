import type { MergedPr, MergeMethod, RepositoryFacts } from './core/merge'
export interface MergeInput {
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
import type { Computer, Failure, PullRequest, Source } from './core/model'
import type { Bell } from './core/bells'
export interface Snapshot {
  bells?: Bell[]
  notificationsOff?: boolean
  demo?: boolean
  computers: Computer[]
  prs: PullRequest[]
  repos: Record<string, Source<RepositoryFacts>>
  merged: MergedPr[]
  mergedError: Failure | null
  total: number
  itemsAt: number
  prsAt: number
  error: Failure | null
  running?: string[]
  focus: boolean
}
export type Chunk = { index: number; count: number; data: string }
declare module 'orca' {
  interface PluginRequests {
    'board.get': { input: { index: number; fresh?: boolean }; output: Chunk }
    'pr.read': {
      input: { repo: string; number: number }
      output:
        | { merged: true }
        | { merged: false; pr: PullRequest & { behind?: string }; facts: Source<RepositoryFacts> }
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
