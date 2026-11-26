import type { Progress } from '../src/protocol'
import {
  fromFailure,
  fromThrown,
  type AttemptFailure,
  type MergeAttemptError,
  type MergeStep,
} from '../src/core/merge-error'
import { mergeErrorDetails } from './merge-error-details'
import type { MappedPr } from '../src/core/model'
import { prKey } from '../src/core/model'
import type { ConfirmedMerge, MergeMethod, MergePreferences } from '../src/core/merge'
import { canMergeWithoutDialog } from '../src/core/merge'
import { button, el } from './dom'
import type { mergeDialog } from './merge-dialog'
import type { MergeResult } from './merge-toasts'
import { scrollArea } from './scroll-area'

const requestTimeoutSeconds = 120
const requestOptions = { timeoutMs: requestTimeoutSeconds * 1000 }
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
  let progress: ((event: Progress) => void) | undefined
  orca.plugin.on('merge.progress', (event) => {
    if (event.key === active) progress?.(event)
  })
  function totals() {
    busy = false
    active = ''
    heading.textContent = merged + ' merged' + (failed.size ? ', ' + failed.size + ' failed' : '')
    changed()
    if (!failed.size)
      timer = setTimeout(() => {
        panel.classList.remove('on')
        merged = 0
        changed()
      }, 1400)
  }
  function entry(pr: MappedPr) {
    const node = el('div', '', 'qrow'),
      symbol = el('span', '', 'ic'),
      text = el('div', '', 'txt'),
      name = el('span', pr.title, 'nm'),
      status = el('span', 'queued', 'st')
    const attempts: MergeAttemptError[] = []
    const errors = mergeErrorDetails()
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
    async function attempt(manual: boolean): Promise<'merged' | 'removed' | AttemptFailure> {
      let step: MergeStep = 'PR read'
      try {
        const ref = { repo: pr.repo, number: pr.number, prOnly: !manual }
        const current = await orca.plugin.request('pr.read', ref, requestOptions)
        if ('ok' in current) return fromFailure(current, step)
        if (current.merged || current.closed) return 'removed'
        let fresh: MappedPr = { ...pr, ...current.pr, behind: current.pr.behind }
        let method = approved?.method ?? prefs.mergeMethod
        const same = approved?.sha === fresh.sha
        if (
          !current.facts.ok ||
          !canMergeWithoutDialog(fresh, current.facts.value, method, same ? approved?.facts : undefined) ||
          (prefs.askBeforeMerging && !same)
        ) {
          const choice = await new Promise<typeof approved>(
            (resolve, reject) =>
              void dialog(
                fresh,
                false,
                (m, warnings, live) => {
                  fresh = live
                  resolve({
                    method: m,
                    sha: fresh.sha ?? '',
                    facts: { warnings, behind: fresh.behind, mergeable: fresh.mergeable },
                  })
                },
                () => resolve(undefined),
              ).catch(reject),
          )
          if (!choice) return 'removed'
          approved = choice
          method = choice.method
        }
        step = 'merge'
        let started = false
        const completed = new Promise<boolean>((resolve) => {
          progress = (event) => {
            started = true
            if (event.state === 'failed') resolve(false)
            else if (event.step === 'merge' && event.state === 'done') resolve(true)
          }
        })
        let failure: AttemptFailure
        try {
          const result = await orca.plugin.request(
            'pr.merge',
            { ...ref, method, sha: fresh.sha ?? '', updated: fresh.updated },
            requestOptions,
          )
          if (result.ok && (await completed)) {
            await land(fresh)
            return 'merged'
          }
          failure = result.ok
            ? {
                step,
                short: 'merge not confirmed',
                full: 'GitHub accepted the merge request but did not confirm the merge. Refresh the board to check.',
              }
            : fromFailure(result, started ? 'merge' : 'preflight')
        } catch (err) {
          failure = fromThrown(err, step, requestTimeoutSeconds)
        } finally {
          progress = undefined
        }
        const reread = await orca.plugin.request('pr.read', ref, requestOptions).catch(() => undefined)
        return reread && !('ok' in reread) && (reread.merged || reread.closed) ? 'removed' : failure
      } catch (err) {
        return fromThrown(err, step, requestTimeoutSeconds)
      }
    }
    async function run(manual: boolean): Promise<MergeResult | undefined> {
      const key = prKey(pr)
      active = key
      node.querySelector('.rt')?.remove()
      for (let i = 0; ; i++) {
        state('run', 'merging', '')
        const bounds = node.getBoundingClientRect(),
          viewport = body.getBoundingClientRect()
        if (bounds.top < viewport.top) body.scrollTop += bounds.top - viewport.top
        else if (bounds.bottom > viewport.bottom) body.scrollTop += bounds.bottom - viewport.bottom
        const result = await attempt(manual)
        if (typeof result === 'string') {
          failed.delete(key)
          if (result === 'merged') {
            errors.line.remove()
            errors.details.remove()
            merged++
            node.style.height = node.offsetHeight + 'px'
            state('merged', 'merged', '✓')
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            node.classList.add('done')
            node.style.height = '0px'
            await sleep(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250)
          }
          node.remove()
          return result === 'merged' ? { pr, result: manual ? 'merged (manual retry)' : 'merged' } : undefined
        }
        attempts.push({ n: attempts.length + 1, at: new Date(), ...result })
        const seconds = waits[i]
        if (manual || seconds === undefined) break
        for (let remaining = seconds; remaining; remaining--) {
          state('retry', 'failed, retrying in ' + remaining + 's', '')
          await sleep(1000)
        }
      }
      failed.add(key)
      state('fail', manual ? 'failed again' : 'failed after 2 retries', '!')
      errors.update(attempts)
      text.append(errors.line)
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
        errors.details,
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
      if (!failed.size) merged = 0
      busy = true
      panel.classList.add('on')
      changed()
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
