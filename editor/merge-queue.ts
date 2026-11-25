import type { MappedPr } from '../src/core/model'
import { prKey } from '../src/core/model'
import type { ConfirmedMerge, MergeMethod, MergePreferences } from '../src/core/merge'
import { canMergeWithoutDialog } from '../src/core/merge'
import { button, el } from './dom'
import type { mergeDialog } from './merge-dialog'
import type { MergeResult } from './merge-toasts'
import { scrollArea } from './scroll-area'

const waits = [2, 4]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export function mergeQueue(
  prefs: MergePreferences,
  dialog: ReturnType<typeof mergeDialog>,
  land: (pr: MappedPr) => Promise<void>,
  notify: (results: MergeResult[], batch: boolean) => Promise<void>,
  changed: () => void,
) {
  const panel = el('div', '', 'queue'),
    heading = el('b'),
    head = el('div', '', 'qh'),
    track = el('div', '', 'qbar'),
    bar = el('i'),
    body = el('div', '', 'qbody')
  scrollArea(body)
  head.append(heading)
  track.append(bar)
  panel.append(head, track, body)
  const failed = new Set<string>()
  let busy = false,
    merged = 0,
    active = '',
    timer: ReturnType<typeof setTimeout>
  function totals() {
    busy = false
    active = ''
    heading.textContent = merged + ' merged' + (failed.size ? ', ' + failed.size + ' failed' : '')
    changed()
    if (!failed.size)
      timer = setTimeout(() => {
        panel.classList.remove('on')
        merged = 0
      }, 1400)
  }
  function entry(pr: MappedPr) {
    const node = el('div', '', 'qrow'),
      symbol = el('span', '', 'ic'),
      text = el('div', '', 'txt'),
      name = el('span', pr.title, 'nm'),
      status = el('span', 'queued', 'st')
    name.title = pr.title
    text.append(name, status)
    node.append(symbol, text)
    body.append(node)
    function state(kind: string, label: string, mark: string) {
      node.className = 'qrow ' + kind
      status.textContent = label
      const dot = el('span', mark, kind === 'run' ? 'spin' : mark ? '' : 'dot')
      symbol.replaceChildren(dot)
    }
    state('', 'queued', '')
    let approved: { method: MergeMethod; sha: string; facts: ConfirmedMerge } | undefined
    async function attempt(): Promise<'merged' | 'removed' | 'failed'> {
      const current = await orca.plugin.request('pr.read', pr, { timeoutMs: 120000 })
      if (current.merged || current.closed) return 'removed'
      const fresh = { ...pr, ...current.pr, behind: current.pr.behind }
      let method = approved?.method ?? prefs.mergeMethod
      const same = approved?.sha === fresh.sha
      if (
        !current.facts.ok ||
        !canMergeWithoutDialog(fresh, current.facts.value, method, same ? approved?.facts : undefined) ||
        (prefs.askBeforeMerging && !same)
      ) {
        const choice = await new Promise<typeof approved>((resolve) =>
          dialog(
            fresh,
            current.facts,
            false,
            (m, warnings) =>
              resolve({
                method: m,
                sha: fresh.sha ?? '',
                facts: { warnings, behind: fresh.behind, mergeable: fresh.mergeable },
              }),
            () => resolve(undefined),
          ),
        )
        if (!choice) return 'removed'
        approved = choice
        method = choice.method
      }
      const result = await orca.plugin.request(
        'pr.merge',
        { repo: pr.repo, number: pr.number, method, sha: fresh.sha ?? '', updated: fresh.updated },
        { timeoutMs: 120000 },
      )
      if (result.ok) {
        await land(fresh)
        return 'merged'
      }
      const reread = await orca.plugin.request('pr.read', pr, { timeoutMs: 120000 })
      return reread.merged || reread.closed ? 'removed' : 'failed'
    }
    async function run(manual: boolean): Promise<MergeResult | undefined> {
      const key = prKey(pr)
      active = key
      node.querySelector('button')?.remove()
      for (let i = 0; ; i++) {
        state('run', 'merging', '')
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const result = await attempt().catch(() => 'failed' as const)
        if (result !== 'failed') {
          failed.delete(key)
          if (result === 'merged') {
            merged++
            state('done', 'merged', '✓')
            await sleep(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250)
          }
          node.remove()
          return result === 'merged' ? { pr, result: manual ? 'merged (manual retry)' : 'merged' } : undefined
        }
        const seconds = waits[i]
        if (manual || seconds === undefined) break
        for (let remaining = seconds; remaining; remaining--) {
          state('retry', 'failed, retrying in ' + remaining + 's', '')
          await sleep(1000)
        }
      }
      failed.add(key)
      state('fail', manual ? 'failed again' : 'failed after 2 retries', '!')
      node.append(
        button(
          'Retry',
          async () => {
            if (busy) return
            busy = true
            changed()
            const r = await run(true)
            try {
              if (r?.result === 'merged (manual retry)') await notify([r], false)
            } finally {
              totals()
            }
          },
          'rt',
        ),
      )
      return { pr, result: 'failed' }
    }
    return { run }
  }
  return {
    panel,
    get busy() {
      return busy
    },
    get active() {
      return active
    },
    async start(prs: MappedPr[]) {
      if (busy) return
      const batch = prs.filter((p) => !failed.has(prKey(p)))
      if (!batch.length) return
      clearTimeout(timer)
      busy = true
      changed()
      panel.classList.add('on')
      heading.textContent = 'Merging ' + batch.length + ' pull request' + (batch.length === 1 ? '' : 's')
      const entries = batch.map(entry),
        results: MergeResult[] = []
      bar.style.width = '0%'
      try {
        for (const [i, row] of entries.entries()) {
          const result = await row.run(false)
          if (result) results.push(result)
          bar.style.width = ((i + 1) / entries.length) * 100 + '%'
        }
        active = ''
        await notify(results, batch.length > 1)
      } finally {
        totals()
      }
    },
  }
}
