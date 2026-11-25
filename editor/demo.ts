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
    request: (k: string) => {
      if (k === 'board.get' || k === 'board.refresh') {
        if (state !== 'loading') send()
        return null
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
  plugin: { ...fake.plugin, request: async (k: string) => fake.plugin.request(k) },
} as unknown as OrcaFrameApi
void import('./board')
