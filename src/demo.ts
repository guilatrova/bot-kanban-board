import { items, bots, pullRequest } from './core/normalize'
import { prKey, type PullRequest, type Source } from './core/model'
import type { Progress, Snapshot } from './protocol'
export function demoBoard(state: string | null = null) {
  const list = bots(
    {
      bots: [
        { id: 'demo-hazel', name: 'Hazel' },
        { id: 'demo-fern', name: 'Fern' },
        { id: 'demo-lark', name: 'Lark' },
      ],
    },
    'local',
  )
  const entries = [
    ['needs_you', 'Choose the orchard sample', 'Which collection should we use for the first run?'],
    ['in_progress', 'Calibrate the field sensors', 'Verifying readings against the baseline.'],
    ['waiting', 'Review the irrigation schedule', 'Waiting for the field report.'],
    ['needs_you', 'Confirm the sampling interval', 'Should the sampler run every hour?'],
    ['in_progress', 'Prepare the seedling inventory', 'Imported the greenhouse records.'],
  ]
  entries.push(['planned', 'Plan the next soil survey', ''])
  if (state !== 'empty')
    entries.push(['done', 'Collect the spring readings', ''], ['canceled', 'Retire the old sampling route', ''])
  const demoItems = entries.flatMap(([status, title, subject], n) =>
    items(
      {
        items: [
          {
            number: n + 1,
            status,
            title,
            description:
              n < 2
                ? 'Review orchard/sample#' + (n + 1) + ' before collecting the first batch.'
                : 'Prepare the seasonal field survey.',
            doneMeans: 'The field notes are ready for review.',
            closedAt: status === 'done' || status === 'canceled' ? Date.now() : undefined,
            lastActivityAt: Date.now() - (n + 1) * 3600000,
            chat: { title: 'Field survey' },
            question: { text: subject, options: ['Use spring readings', 'Use autumn readings'] },
            wait: status === 'waiting' ? { text: subject } : null,
            links: [
              {
                kind: 'dispatch',
                title: 'Field notebook',
                state: status === 'in_progress' ? 'working' : 'done',
                report: { subject, body: 'The first batch has been recorded.' },
              },
            ],
          },
        ],
      },
      list[n % list.length]!,
      [],
    ),
  )
  const pr = pullRequest({
    number: 1,
    title: 'Sample marker',
    url: 'https://github.com/orchard/sample/pull/1',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'marker',
    baseRefName: 'main',
    body: 'Closes #42',
    updatedAt: '2026-01-01T00:00:00Z',
    additions: 5,
    deletions: 2,
    changedFiles: 1,
    mergeable: 'MERGEABLE',
    repository: { nameWithOwner: 'orchard/sample' },
    closingIssuesReferences: { nodes: [] },
    commits: { nodes: [] },
  })
  pr.title = 'Add collection markers to the field map'
  pr.checks = 'SUCCESS'
  pr.sha = 'a'.repeat(40)
  if (['warnings', 'danger', 'progress'].includes(state || '')) {
    pr.draft = true
    pr.checks = null
    pr.base = 'spring-survey'
    pr.additions = 5012
  }
  if (state === 'danger') pr.title = 'Test only · do not merge field readings'
  if (state === 'conflict') pr.mergeable = 'CONFLICTING'
  pr.updated = new Date(Date.now() - 2300000).toISOString()
  const data: Snapshot = {
    demo: true,
    computers: [
      {
        key: 'local',
        name: 'Field station',
        source: { ok: true, value: { bots: list, items: demoItems, workspaces: [] } },
      },
    ],
    prs: [
      pr,
      {
        ...pr,
        number: 2,
        url: pr.url.replace(/1$/, '2'),
        title: 'Update watering calendar',
        head: 'calendar',
        base: pr.head,
        draft: true,
        body: '',
        closes: [],
      },
    ],
    repos: {
      [pr.repo]: {
        ok: true,
        value: {
          push: state !== 'no-permission',
          defaultBranch: 'main',
          methods: ['squash', 'merge', 'rebase'],
        },
      },
    },
    merged: [],
    mergedError: null,
    total: 2,
    prsAt: Date.now(),
    itemsAt: Date.now(),
    error: null,
    focus: false,
  }
  if (state !== 'empty') {
    for (const [number, title] of [
      'Record the summer survey',
      'Import historical readings',
      'Resolve survey boundaries',
    ].entries()) {
      const n = number + 3
      data.prs.push({
        ...pr,
        number: n,
        title,
        head: 'survey-' + n,
        base: 'main',
        url: pr.url.replace(/1$/, String(n)),
        checks: n === 4 ? null : 'SUCCESS',
        additions: n === 4 ? 5012 : 5,
        mergeable: n === 5 ? 'CONFLICTING' : 'MERGEABLE',
        draft: false,
      })
    }
    data.total = data.prs.length
    data.merged.push({
      ...pr,
      number: 6,
      title: 'Publish spring observations',
      url: pr.url.replace(/1$/, '6'),
      mergedAt: new Date().toISOString(),
    })
  }
  if (state === 'paired' || state === 'bot-warning') {
    const station = data.computers[0]!
    station.key = 'field-station'
    if (station.source.ok) {
      for (const row of [...station.source.value.bots, ...station.source.value.items]) row.computer = station.key
      if (state === 'bot-warning')
        station.source.value.bots[0]!.warning = {
          ok: false,
          command: 'orca bot work list',
          message: 'Work list unavailable.',
          next: 'Refresh to retry.',
        }
    }
    data.computers.unshift({
      key: 'local',
      name: 'This computer',
      source: { ok: true, value: { bots: [], items: [], workspaces: [] } },
    })
  }
  if (state === 'unreachable')
    data.computers.push({
      key: 'other',
      name: 'Greenhouse',
      source: {
        ok: false,
        command: 'orca bot list',
        message: 'Connection timed out.',
        next: 'Reconnect the computer and refresh.',
      },
    })
  if (state === 'signed-out') {
    data.prs = []
    data.prsAt = 0
    data.total = 0
    data.error = {
      ok: false,
      command: 'gh api user',
      message: 'GitHub is signed out.',
      next: 'Run gh auth login and refresh.',
    }
  }
  return data
}

export async function demoMerge(
  pr: PullRequest,
  progress: (event: Progress) => void,
  onReady: () => void,
  fail: boolean,
): Promise<Source<null>> {
  const key = prKey(pr)
  for (const step of pr.draft ? (['ready', 'merge'] as const) : (['merge'] as const)) {
    progress({ key, step, state: 'running' })
    await new Promise((resolve) => setTimeout(resolve, 900))
    if (step === 'merge' && fail)
      return { ok: false, command: 'Demo', message: 'Required status check "field survey" is pending.', next: '' }
    if (step === 'ready') onReady()
    progress({ key, step, state: 'done' })
  }
  return { ok: true, value: null }
}
