import {
  canMergeWithoutDialog,
  methodLabels,
  type MergeMethod,
  type ConfirmedMerge,
  type RepositoryFacts,
} from '../src/core/merge'
import { prKey, type MappedPr, type Source } from '../src/core/model'
import { el, button, external } from './dom'
import { icon } from './lanes'
const uncertain = "Couldn't confirm the merge. Check the pull request on GitHub before retrying."
function reason(message: string) {
  const pending = /(?:status )?check ["']([^"'\n]+)["'] (?:is |was )?(?:pending|running)/i.exec(message)
  if (pending) return 'The ' + pending[1] + ' check is still running. Retry once it passes.'
  if (/permission|forbidden|authorized|403/i.test(message))
    return 'GitHub denied the merge. Check your repository permissions.'
  if (/conflict/i.test(message)) return 'Resolve the conflicts on GitHub before retrying.'
  if (/rule|protected|required/i.test(message))
    return 'Repository rules blocked the merge. Check the pull request on GitHub.'
  if (/changed|method unavailable/i.test(message))
    return 'The pull request or repository settings changed. Retry to read them again.'
  return uncertain
}
export function mergeToasts(redraw: () => void, review: (pr: MappedPr, facts: Source<RepositoryFacts>) => void) {
  const stack = el('div', '', 'toasts')
  stack.setAttribute('aria-live', 'polite')
  document.body.append(stack)
  const entries = new Map<string, HTMLElement>()
  orca.plugin.on('merge.progress', (e) => {
    const heading = entries.get(e.key)?.querySelector('strong')
    if (heading && e.state === 'running')
      heading.textContent = (e.step === 'ready' ? 'Marking ready ' : 'Merging ') + e.key
  })
  function running(key: string) {
    return entries.get(key)?.dataset.state === 'running'
  }
  async function start(pr: MappedPr, method: MergeMethod, confirmed?: ConfirmedMerge) {
    const key = prKey(pr)
    if (running(key) || !pr.sha) return
    const toast = entries.get(key) ?? el('div', '', 'toast')
    entries.set(key, toast)
    const body = el('div', '', 'tbody'),
      heading = el('strong'),
      detail = el('small')
    body.append(heading, detail)
    toast.dataset.state = 'running'
    heading.textContent = (pr.draft ? 'Marking ready ' : 'Merging ') + key
    detail.textContent = methodLabels[method] + ' · ' + pr.title
    toast.replaceChildren(el('span', '', 'tspin'), body)
    if (!toast.isConnected) stack.append(toast)
    redraw()
    function remove() {
      toast.remove()
      entries.delete(key)
    }
    function done() {
      toast.dataset.state = 'done'
      const mark = el('span', '', 'tmark')
      mark.append(icon('M5 12.5l4.5 4.5L19 7.5'))
      heading.textContent = 'Merged ' + key
      detail.textContent = methodLabels[method] + ' · moved to Merged'
      toast.replaceChildren(mark, body)
      setTimeout(() => {
        toast.classList.add('fading')
        setTimeout(remove, 220)
      }, 3500)
      redraw()
    }
    function failed(message: string) {
      toast.dataset.state = 'failed'
      heading.textContent = 'Merge failed · ' + key
      detail.textContent = message
      const mark = el('span', '!', 'tmark'),
        actions = el('div', '', 'tactions')
      const retry = button(
        'Retry',
        async () => {
          retry.disabled = true
          try {
            const current = await orca.plugin.request(
              'pr.read',
              { repo: pr.repo, number: pr.number },
              { timeoutMs: 120000 },
            )
            if (current.merged) {
              actions.remove()
              done()
              return
            }
            const fresh = { ...pr, ...current.pr, behind: current.pr.behind }
            if (
              fresh.sha !== pr.sha ||
              !current.facts.ok ||
              !canMergeWithoutDialog(fresh, current.facts.value, method, confirmed)
            ) {
              remove()
              review(fresh, current.facts)
              return
            }
            await start(fresh, method, confirmed)
          } catch {
            detail.textContent = uncertain
          } finally {
            retry.disabled = false
          }
        },
        'confirm',
      )
      actions.append(retry, external('Open on GitHub', pr.url))
      const close = button('', remove, 'tclose')
      close.setAttribute('aria-label', 'Dismiss')
      close.append(icon('M6 6l12 12M18 6L6 18'))
      body.append(actions)
      toast.replaceChildren(mark, body, close)
      redraw()
    }
    try {
      const result = await orca.plugin.request(
        'pr.merge',
        { repo: pr.repo, number: pr.number, sha: pr.sha, updated: pr.updated, method },
        { timeoutMs: 120000 },
      )
      if (result.ok) done()
      else failed(reason(result.message))
    } catch {
      failed(uncertain)
    }
  }
  return { running, start }
}
