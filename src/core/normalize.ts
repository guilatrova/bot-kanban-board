import {
  statuses,
  type Bot,
  type Item,
  type Status,
  type Worker,
  type Workspace,
  type PullRequest,
  type FileChange,
} from './model'
export function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected an object')
  return value as Record<string, unknown>
}
export function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error('Expected an array')
  return value as unknown[]
}
export function str(row: Record<string, unknown>, key: string) {
  const v = row[key]
  if (typeof v !== 'string') throw Error('Missing string: ' + key)
  return v
}
export function num(row: Record<string, unknown>, key: string) {
  const v = row[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw Error('Missing number: ' + key)
  return v
}
const opt = (v: unknown) => (typeof v === 'string' ? v : null)
const nested = (v: unknown) => (v == null ? {} : obj(v))
export function bots(data: unknown, computer: string): Bot[] {
  return rows(obj(data).bots)
    .map(obj)
    .map((b) => ({ computer, id: str(b, 'id'), name: str(b, 'name'), home: opt(b.botHome) }))
}
export function workspaces(data: unknown, computer: string): Workspace[] {
  return rows(obj(data).worktrees)
    .map(obj)
    .filter((w) => typeof w.bot === 'string')
    .map((w) => ({
      computer,
      id: str(w, 'worktreeId'),
      bot: str(w, 'bot'),
      name: str(w, 'displayName'),
      repo: str(w, 'repo'),
      branch: opt(w.branch)?.replace(/^refs\/heads\//, '') ?? null,
      home: w.botHome === true ? opt(w.path) : opt(w.botHome),
    }))
}
function worker(w: Record<string, unknown>): Worker {
  const r = nested(w.report)
  return {
    title: str(w, 'title'),
    state: opt(w.state),
    ref: opt(w.dispatchId) ?? opt(w.ref),
    workspace: opt(w.workspace),
    subject: opt(r.subject),
    body: opt(r.body),
  }
}
export function workers(data: unknown) {
  return rows(obj(data).items).map(obj).map(worker)
}
export function items(data: unknown, bot: Bot, live: Worker[]): Item[] {
  return rows(obj(data).items)
    .map(obj)
    .flatMap((i) => {
      const status = str(i, 'status')
      if (['done', 'canceled'].includes(status)) return []
      if (!statuses.includes(status as Status)) throw Error('Unknown Item status')
      const q = nested(i.question),
        chat = nested(i.chat),
        links = rows(i.links ?? []).map(obj)
      const dispatches = links
        .filter((l) => l.kind === 'dispatch')
        .sort((a, b) => Number(a.settledAt ?? a.startedAt ?? 0) - Number(b.settledAt ?? b.startedAt ?? 0))
        .map(worker)
        .map((w) => {
          const active = live.find((a) => a.ref && a.ref === w.ref)
          return { ...w, state: active?.state ?? w.state, workspace: active?.workspace ?? w.workspace }
        })
      return [
        {
          computer: bot.computer,
          bot: bot.name,
          number: num(i, 'number'),
          title: str(i, 'title'),
          status: status as Status,
          updated: num(i, 'lastActivityAt'),
          chat: opt(chat.title),
          chatId: opt(chat.id),
          description: opt(i.description),
          done: opt(i.doneMeans),
          question: opt(q.text),
          options: rows(q.options ?? rows(q.decisions ?? []).flatMap((d) => rows(obj(d).replies ?? []))).map((o) =>
            typeof o === 'string' ? o : str(obj(o), typeof obj(o).label === 'string' ? 'label' : 'text'),
          ),
          wait: opt(nested(i.wait).text),
          workers: dispatches,
          text: [
            i.title,
            i.description,
            i.doneMeans,
            q.text,
            ...links
              .filter((l) => l.kind !== 'pr')
              .flatMap((l) => [l.name, l.title, l.url, l.ref, nested(l.report).subject, nested(l.report).body]),
          ].join(' '),
        },
      ]
    })
}
export function pullRequest(input: unknown): PullRequest {
  const p = obj(input)
  if (typeof p.isDraft !== 'boolean') throw Error('Missing isDraft')
  const commit = rows(obj(p.commits).nodes)[0]
  return {
    repo: str(obj(p.repository), 'nameWithOwner'),
    number: num(p, 'number'),
    title: str(p, 'title'),
    url: str(p, 'url'),
    draft: p.isDraft,
    sha: opt(p.headRefOid) ?? undefined,
    head: str(p, 'headRefName'),
    base: str(p, 'baseRefName'),
    body: str(p, 'body'),
    updated: str(p, 'updatedAt'),
    additions: num(p, 'additions'),
    deletions: num(p, 'deletions'),
    files: num(p, 'changedFiles'),
    mergeable: str(p, 'mergeable'),
    checks: commit ? opt(nested(obj(obj(commit).commit).statusCheckRollup).state) : null,
    closes: rows(obj(p.closingIssuesReferences).nodes)
      .map(obj)
      .map((r) => ({ number: num(r, 'number'), repo: str(obj(r.repository), 'nameWithOwner') })),
  }
}
export function fileChange(value: unknown): FileChange {
  const f = obj(value)
  return {
    filename: str(f, 'filename'),
    url: str(f, 'blob_url'),
    additions: num(f, 'additions'),
    deletions: num(f, 'deletions'),
    patch: opt(f.patch),
  }
}
