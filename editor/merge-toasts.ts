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
  return async (results: MergeResult[], batch: boolean) => {
    if (!results.length || (!batch && results[0]?.result === 'failed')) return
    const toast = el('div', '', 'toast'),
      body = el('div', '', 'tbody'),
      heading = el('strong'),
      detail = el('small')
    body.append(heading, detail)
    toast.append(body)
    stack.append(toast)
    if (!prefs.tellBot) {
      heading.textContent = batch ? 'Batch finished' : 'Merged'
      detail.textContent = 'No bot was told (turned off in Settings)'
      setTimeout(() => toast.remove(), 3500)
      return
    }
    const bot = prefs.botName
    const message = {
      botName: bot,
      computer: prefs.computer,
      subject: batch
        ? 'Batch merged (' + results.filter((r) => r.result === 'merged').length + '/' + results.length + ')'
        : 'PR merged',
      body: results.map((r) => prKey(r.pr) + ': ' + r.result + ' ' + r.pr.url).join('\n'),
    }
    async function send(retry: boolean) {
      const ok = await panelRequest('bot.tell', message, { timeoutMs: 120000 }).catch(() => false)
      if (ok) {
        heading.textContent = 'Told ' + bot + (batch ? ' about the batch' : '')
        detail.textContent = batch ? 'One message for the whole batch' : 'One message'
        setTimeout(() => toast.remove(), 3500)
      } else {
        heading.textContent = 'Could not tell ' + (bot || 'the bot') + '. The merge is done.'
        detail.replaceChildren()
        if (!retry)
          detail.append(
            button('Try again', () => {
              detail.replaceChildren()
              return send(true)
            }),
          )
        detail.append(button('Settings', () => settings.click()))
      }
    }
    await send(false)
  }
}
