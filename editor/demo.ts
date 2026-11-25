import { prKey } from '../src/core/model'
import { manualBotNotification } from '../src/core/merge'
import { demoBoard } from '../src/demo'
import type { OrcaFrameApi } from 'orca/frame'
const state = new URLSearchParams(location.search).get('state')
const data = demoBoard(state)
const handlers = new Map<string, (v: unknown) => void>()
const send = () => handlers.get('board.changed')?.({ index: 0, count: 1, data: JSON.stringify(data) })
const fake = {
  storage: {
    get: (k: string) => JSON.parse(sessionStorage.getItem(k) || 'null') as unknown,
    set: (k: string, v: unknown) => sessionStorage.setItem(k, JSON.stringify(v)),
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
        const key = prKey(row)
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
          notification: manualBotNotification,
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
                url: data.prs[0]?.url,
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
