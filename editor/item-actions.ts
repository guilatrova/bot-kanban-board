import type { Preferences } from '../src/protocol'
import { preferenceKeys } from '../src/core/startup-preferences'
import { itemStatusActions } from '../src/core/flags'
import { panelRequest } from './panel-request'
import { getStorage, setStorage } from './storage'
import { itemKey, type Item } from '../src/core/model'
import {
  moveState,
  moveTimeout,
  isAsleep,
  snoozeChoices,
  snoozeUntil,
  type Target,
  parseActions,
  targets,
} from '../src/core/actions'
import { popover } from './popover'
import { panel, ask } from './controls'
import { el, button, labels, notice } from './dom'

const names = { ...labels, done: 'Done', canceled: 'Cancel' }
export async function readActions(demo: boolean, initial?: Preferences) {
  const key = preferenceKeys(demo).actions
  const stored = initial ? initial[key] : await getStorage(key)
  const state = parseActions(stored)
  return { state, save: () => setStorage(key, state) }
}
export function itemActions(store: Awaited<ReturnType<typeof readActions>>, redraw: () => void) {
  const { state, save } = store
  let timer: ReturnType<typeof setTimeout>
  function changed() {
    void save().catch(notice)
    redraw()
  }
  function reconcile(items: Item[], closed: Record<string, Target>) {
    let dirty = false
    const now = Date.now()
    const deadlines = items.map((i) => i.snoozedUntil || 0)
    for (const [key, move] of Object.entries(state.moves)) {
      const item = items.find((i) => itemKey(i) === key)
      const result = moveState(move, item?.status ?? closed[key], now)
      if (result === 'pending') deadlines.push(move.at + moveTimeout)
      else if (result === 'confirmed' || closed[key]) {
        delete state.moves[key]
        dirty = true
      }
    }
    for (const [key, end] of Object.entries(state.sleeps)) {
      if (end > now) deadlines.push(end)
      else {
        delete state.sleeps[key]
        dirty = true
      }
    }
    if (dirty) void save().catch(notice)
    clearTimeout(timer)
    const next = Math.min(...deadlines.filter((d) => d > now))
    if (Number.isFinite(next)) timer = setTimeout(redraw, Math.min(2147483647, next - now))
  }
  function move(item: Item, target: Target) {
    if (!itemStatusActions || target === item.status) return
    function request(reason?: string) {
      state.moves[itemKey(item)] = { target, at: Date.now() }
      changed()
      const dialog = panel('Move to ' + names[target] + ' requested')
      const text = reason
        ? 'Please cancel item #' + item.number + '. Reason: ' + reason
        : 'Please move item #' + item.number + ' to ' + names[target] + '.'
      const field = el('textarea')
      field.readOnly = true
      field.value = text
      field.setAttribute('aria-label', 'Request to paste')
      dialog.append(
        el('p', 'Copy this request, then open the bot chat in Orca and paste it. The bot has not been told.'),
        field,
        button('Open bot chat in Orca', async () => {
          const result = await panelRequest('board.jump', {
            computer: item.computer,
            bot: item.bot,
            number: item.number,
          })
          dialog.append(el('p', result))
        }),
      )
      field.select()
    }
    if (target === 'canceled') ask('Reason for canceling', '', request)
    else request()
  }
  function snooze(item: Item, choice: (typeof snoozeChoices)[number]) {
    state.sleeps[itemKey(item)] = snoozeUntil(choice, Date.now())
    changed()
    notice('Snoozed on this board only; the bot is not told.')
  }
  function menu(item: Item, anchor: HTMLElement) {
    const parent = popover(anchor)
    parent.node.setAttribute('role', 'menu')
    const shortcuts = new Map<string, HTMLButtonElement>()
    function entry(label: string, hint: string, action: () => unknown, current = false, tone?: string) {
      const row = button(
        label,
        () => {
          parent.close(true)
          return action()
        },
        'mi',
      )
      row.append(el('small', hint, 'k'))
      row.setAttribute('role', current ? 'menuitemradio' : 'menuitem')
      if (current) {
        row.setAttribute('aria-checked', 'true')
        row.prepend('✓ ')
      }
      if (tone) {
        const dot = el('span', '', 'dot')
        dot.style.setProperty('--dot', 'var(--' + tone + ')')
        row.prepend(dot)
      }
      parent.node.append(row)
      shortcuts.set(hint.toLowerCase(), row)
      return row
    }
    if (itemStatusActions) {
      parent.node.append(el('div', 'Move to', 'mlabel'))
      for (const [target, key] of [
        ['needs_you', 'N'],
        ['in_progress', 'P'],
        ['waiting', 'W'],
      ] as const)
        entry(
          names[target],
          key,
          () => move(item, target),
          item.status === target || (item.status === 'planned' && target === 'waiting'),
          target,
        )
      parent.node.append(el('hr'))
      entry('Complete', 'D', () => move(item, 'done'), false, 'ok')
      entry('Cancel…', '⌫', () => move(item, 'canceled'), false, 'bad')
      parent.node.append(el('hr'))
    }
    let sub: ReturnType<typeof popover> | undefined
    function openSub() {
      if (sub?.node.isConnected) {
        sub.node.querySelector('button')?.focus()
        return
      }
      sub = popover(trigger, true)
      sub.node.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopImmediatePropagation()
            parent.close(true)
          }
        },
        { capture: true },
      )
      for (const choice of snoozeChoices)
        sub.node.append(
          button(
            choice,
            () => {
              parent.close(true)
              snooze(item, choice)
            },
            'mi',
          ),
        )
      sub.position()
    }
    const trigger = button('Snooze', openSub, 'mi')
    trigger.append(el('small', '›', 'k'))
    trigger.setAttribute('aria-haspopup', 'menu')
    trigger.onkeydown = (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        openSub()
      }
    }
    parent.node.append(trigger)
    entry('Open chat in Orca', '↵', async () =>
      notice(await panelRequest('board.jump', { computer: item.computer, bot: item.bot, number: item.number })),
    )
    parent.node.addEventListener('dismiss', () => sub?.close())
    parent.node.addEventListener('keydown', (e) => {
      const row = shortcuts.get(e.key === 'Backspace' || e.key === 'Delete' ? '⌫' : e.key.toLowerCase())
      if (row && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        row.click()
      }
    })
    parent.position()
  }
  function selector(item: Item) {
    const label = el('label', 'Request status '),
      select = el('select')
    for (const target of targets) {
      const opt = el('option', names[target])
      opt.value = target
      opt.selected = target === item.status
      select.append(opt)
    }
    select.onchange = () => {
      move(item, select.value as Target)
      select.value = item.status
    }
    label.append(select)
    return label
  }
  let list: HTMLDialogElement | undefined
  function showList(items: Item[]) {
    list = panel('Snoozed Items')
    syncList(items)
  }
  function syncList(items: Item[]) {
    if (!list?.open) return
    list.querySelector('section')?.remove()
    const section = el('section')
    for (const item of items) {
      const by = isAsleep(item, state.sleeps, Date.now())
      const row = el('article', '', 'sleeping')
      row.append(
        el('small', item.bot + ' · #' + item.number),
        el('h3', item.title),
        el('p', by === 'Orca' ? 'Snoozed by Orca' : 'Snoozed on this board only; the bot is not told.'),
      )
      if (by === 'board')
        row.append(
          button('Wake up now', () => {
            delete state.sleeps[itemKey(item)]
            changed()
          }),
        )
      section.append(row)
    }
    if (!items.length) section.append(el('p', 'No snoozed Items.'))
    list.append(section)
  }
  return {
    move,
    menu,
    selector,
    reconcile,
    showList,
    syncList,
    pending(i: Item) {
      if (!itemStatusActions) return ''
      const m = state.moves[itemKey(i)]
      if (!m) return ''
      return moveState(m, i.status, Date.now()) === 'expired'
        ? 'The bot did not apply the move to ' + names[m.target]
        : 'Move to ' + names[m.target] + ' requested'
    },
  }
}
