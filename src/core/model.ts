export type Failure = { ok: false; command: string; message: string; next: string }
export type Source<T> = { ok: true; value: T } | Failure
export const statuses = ['planned', 'needs_you', 'in_progress', 'waiting'] as const
export type Status = (typeof statuses)[number]
export interface Bot {
  computer: string
  id: string
  name: string
  warning?: Failure
  home: string | null
}
export interface Workspace {
  computer: string
  id: string
  bot: string
  name: string
  repo: string
  branch: string | null
  home: string | null
}
export interface Worker {
  title: string
  state: string | null
  ref: string | null
  workspace: string | null
  subject: string | null
  body: string | null
}
export interface Item {
  computer: string
  bot: string
  number: number
  title: string
  status: Status
  snoozedUntil?: number
  updated: number
  chat: string | null
  chatId: string | null
  description: string | null
  done: string | null
  question: string | null
  options: string[]
  wait: string | null
  workers: Worker[]
  text: string
}
export interface Computer {
  key: string
  name: string
  warning?: Failure
  source: Source<{ closed?: Record<string, 'done' | 'canceled'>; bots: Bot[]; items: Item[]; workspaces: Workspace[] }>
}
export interface IssueRef {
  repo: string
  number: number
}
export interface PullRequest {
  repo: string
  number: number
  title: string
  url: string
  crossRepository: boolean
  draft: boolean
  sha?: string
  head: string
  base: string
  body: string
  updated: string
  additions: number
  deletions: number
  files: number
  mergeable: string
  checks: string | null
  closes: IssueRef[]
}
export interface MappedPr extends PullRequest {
  behind?: string
  items: Item[]
  workspaces: Workspace[]
  how: 'branch' | 'item' | 'issue' | null
}
export interface FileChange {
  filename: string
  additions: number
  deletions: number
  patch: string | null
  url: string
}
export const botKey = (computer: string, bot: string) => JSON.stringify([computer, bot])
export const itemKey = (item: Pick<Item, 'computer' | 'bot' | 'number'>) =>
  JSON.stringify([item.computer, item.bot, item.number])
export const prKey = (pr: IssueRef) => pr.repo + '#' + pr.number
