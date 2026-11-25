import { items, bots, pullRequest } from '../src/core/normalize'
import type { Snapshot } from '../src/protocol'
import type { OrcaFrameApi } from 'orca/frame'
import fixture from '../test/fixtures/board.json'
const state = new URLSearchParams(location.search).get('state')
const list = bots(
  { bots: [fixture.bot, { id: 'demo-fern', name: 'Fern' }, { id: 'demo-lark', name: 'Lark' }] },
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
          ...fixture.item,
          number: n + 1,
          status,
          title,
          description:
            n === 0
              ? 'Review orchard/sample#1 before collecting the first batch.'
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
const pr = pullRequest(fixture.pr)
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
  computers: [
    {
      key: 'local',
      name: 'Field station',
      source: { ok: true, value: { bots: list, items: demoItems, workspaces: [] } },
    },
  ],
  prs: [
    pr,
    { ...pr, number: 2, title: 'Update watering calendar', head: 'calendar', draft: true, body: '', closes: [] },
  ],
  repos: {
    [pr.repo]: {
      ok: true,
      value: {
        push: state !== 'no-permission',
        defaultBranch: 'main',
        methods: ['squash', 'merge', 'rebase'],
        deleteBranchOnMerge: false,
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
const handlers = new Map<string, (v: unknown) => void>()
const send = () => handlers.get('board.changed')?.({ index: 0, count: 1, data: JSON.stringify(data) })
const fake = {
  storage: {
    get: () => JSON.parse(sessionStorage.getItem('filter') || '[]') as unknown,
    set: (_k: string, v: unknown) => sessionStorage.setItem('filter', JSON.stringify(v)),
  },
  plugin: {
    on: (k: string, fn: (v: unknown) => void) => handlers.set(k, fn),
    request: async (k: string, input?: { repo: string; number: number }) => {
      if (k === 'board.get' || k === 'board.refresh') {
        if (state !== 'loading') send()
        return null
      }
      if (k === 'pr.merge' && input) {
        const row = data.prs.find((p) => p.repo === input.repo && p.number === input.number)!
        const key = row.repo + '#' + row.number
        for (const step of row.draft ? ['ready', 'merge'] : ['merge']) {
          handlers.get('merge.progress')?.({ key, step, state: 'running' })
          await new Promise((resolve) => setTimeout(resolve, 900))
          if (state === 'failure' && step === 'merge') {
            handlers.get('merge.progress')?.({ key, step, state: 'failed' })
            return {
              ok: false,
              command: 'gh api',
              message: 'Required status check "field survey" is pending.',
              next: 'Wait for the check and merge it on GitHub.',
            }
          }
          if (step === 'ready') row.draft = false
          handlers.get('merge.progress')?.({ key, step, state: 'done' })
        }
        data.merged.unshift({
          ...row,
          mergedAt: new Date().toISOString(),
          notification: 'The bot was not told; tell it in Orca',
        })
        data.prs = data.prs.filter((p) => p !== row)
        data.total--
        send()
        return { ok: true, value: null }
      }
      if (k === 'pr.files')
        return {
          ok: true,
          value: {
            data: JSON.stringify([
              {
                filename: 'field-map.ts',
                additions: 2,
                deletions: 1,
                url: pr.url,
                patch: '@@ -1,2 +1,3 @@\n const markers = [\n-  "north",\n+  "north meadow",\n+  "south orchard",',
              },
            ]),
            end: true,
          },
        }
      if (k === 'board.jump') return 'Demo workspace selected.'
      return null
    },
  },
  shell: { openExternal: (url: string) => ({ opened: Boolean(window.open(url, '_blank', 'noopener')) }) },
}
window.orca = {
  ...fake,
  plugin: fake.plugin,
} as unknown as OrcaFrameApi
void import('./board')
