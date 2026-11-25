import type { Computer, Failure, PullRequest, Source } from './core/model'
export interface Snapshot {
  computers: Computer[]
  prs: PullRequest[]
  total: number
  itemsAt: number
  prsAt: number
  error: Failure | null
  focus: boolean
}
export type Chunk = { index: number; count: number; data: string }
declare module 'orca' {
  interface PluginRequests {
    'board.get': { input: undefined; output: null }
    'board.refresh': { input: undefined; output: null }
    'avatar.get': {
      input: { computer: string; bot: string; offset: number }
      output: { data: string; next: number | null } | null
    }
    'pr.files': {
      input: { key: string; updated: string; offset: number }
      output: Source<{ data: string; end: boolean }>
    }
    'board.jump': { input: { computer: string; bot: string; number?: number; workspace?: string }; output: string }
  }
  interface PluginPanelEvents {
    'board.changed': Chunk
    'board.focus': null
  }
}
