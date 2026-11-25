import { items, bots, pullRequest } from './core/normalize'
import type { Snapshot } from './protocol'
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
  pr.sha = 'a'.repeat(40)
  if (['warnings', 'danger', 'failure', 'progress'].includes(state || '')) {
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
