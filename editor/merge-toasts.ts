import { undoQueue, undoWindow, type NoticeState } from '../src/core/undo-queue'
import { countLabel, shortRef } from '../src/core/presentation'
import { panelRequest } from './panel-request'
import type { MergePreferences } from '../src/core/merge'
import { prKey, type MappedPr } from '../src/core/model'
import { button, el } from './dom'

export interface MergeResult {
  pr: MappedPr
  result: 'merged' | 'failed' | 'merged (manual retry)'
}
export function mergeToasts(prefs: MergePreferences, settings: HTMLButtonElement) {
  const stack = el('div', '', 'toasts')
  stack.setAttribute('aria-live', 'polite')
  document.body.append(stack)
  const footer = el('div', '', 'undo-footer')
  footer.hidden = true
  footer.setAttribute('aria-live', 'polite')
  document.body.append(footer)
  new ResizeObserver(() =>
    document.body.style.setProperty('--selection-bottom', footer.hidden ? '8px' : footer.offsetHeight + 12 + 'px'),
  ).observe(footer)
  const queue = undoQueue<MergeResult>(
    {
      now: Date.now,
      after(ms, fn) {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      },
    },
    (results) =>
      panelRequest(
        'bot.tell',
        {
          computer: prefs.computer,
          botName: prefs.botName,
          subject:
            results.length > 1
              ? 'Batch merged (' + results.filter((r) => r.result !== 'failed').length + '/' + results.length + ')'
              : 'PR merged',
          body: results.map((r) => prKey(r.pr) + ': ' + r.result + ' ' + r.pr.url).join('\n'),
        },
        { timeoutMs: 120000 },
      ),
    paint,
  )
  let bot = ''
  function paint(state: NoticeState<MergeResult>) {
    footer.hidden = state.kind === 'idle'
    footer.replaceChildren()
    if (state.kind === 'idle') return
    const text = el('div', '', 'undo-text'),
      title = el('strong'),
      sub = el('small')
    text.append(title, sub)
    footer.append(text)
    const merged = state.refs.filter((r) => r.result !== 'failed')
    const refs = merged.map((r) => shortRef(r.pr)).join(', ')
    sub.textContent = countLabel(merged.length, 'pull request') + ' merged · ' + refs
    if (state.kind === 'pending' || state.kind === 'sending') {
      bot = prefs.botName || 'the bot'
      title.textContent = 'Telling ' + bot + (state.refs.length > 1 ? ' about the batch' : '')
      if (state.kind === 'pending') {
        const track = el('span', '', 'undo-track')
        footer.append(
          track,
          button('Undo', queue.undo, 'undo-primary'),
          button('Send now', () => queue.send(), 'send-now'),
        )
        track.style.animationDuration = Math.min(undoWindow, state.deadline - Date.now()) + 'ms'
      }
    } else if (state.kind === 'failed') {
      title.textContent = 'Could not tell ' + bot + '. The merge is done.'
      footer.append(
        button('Try again', () => queue.send(), 'undo-primary'),
        button('Settings', () => settings.click()),
        button('Dismiss', queue.undo),
      )
    } else if (state.kind === 'canceled') {
      title.textContent = 'Message to ' + bot + ' canceled'
      sub.textContent = 'The merges are done; only the message was stopped.'
      footer.prepend(el('span', '↺', 'undo-icon'))
    } else {
      title.textContent = 'Told ' + bot
      footer.prepend(el('span', '✓', 'undo-icon sent'))
    }
  }
  return (results: MergeResult[], batch: boolean) => {
    if (!results.length || (!batch && results[0]?.result === 'failed')) return
    if (prefs.tellBot) {
      queue.enqueue(results)
      return
    }
    const toast = el('div', '', 'toast'),
      body = el('div', '', 'tbody'),
      heading = el('strong'),
      detail = el('small')
    body.append(heading, detail)
    toast.append(body)
    stack.append(toast)
    heading.textContent = batch ? 'Batch finished' : 'Merged'
    detail.textContent = 'No bot was told (turned off in Settings)'
    setTimeout(() => toast.remove(), 3500)
  }
}
