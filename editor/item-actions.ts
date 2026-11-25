import { itemKey, type Item } from '../src/core/model'
import {
  moveState,
  moveTimeout,
  snoozed,
  snoozeChoices,
  snoozeUntil,
  type Target,
  parseActions,
  targets,
} from '../src/core/actions'
import { panel, ask } from './controls'
import { el, button, labels, notice } from './dom'

const names = { ...labels, done: 'Done', canceled: 'Cancel' }
export async function readActions(demo: boolean) {
  const key = demo ? 'demo-actions' : 'actions'
  const stored = await orca.storage.get(key)
  const state = parseActions(stored)
  return { state, save: () => orca.storage.set(key, state) }
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
    if (target === item.status) return
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
          const result = await orca.plugin.request('board.jump', {
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
  function menu(item: Item, onlySnooze = false) {
    const dialog = panel(onlySnooze ? 'Snooze Item' : 'Item #' + item.number + ' actions')
    if (!onlySnooze)
      for (const target of targets.filter((t) => t !== item.status))
        dialog.append(
          button(names[target], () => {
            dialog.close()
            move(item, target)
          }),
        )
    dialog.append(el('h3', 'Snooze on this board'))
    for (const choice of snoozeChoices)
      dialog.append(
        button(choice, () => {
          dialog.close()
          snooze(item, choice)
        }),
      )
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
  const sleep = (i: Item) => snoozed(i, state.sleeps[itemKey(i)], Date.now())
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
      const by = sleep(item)
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
    sleep,
    reconcile,
    showList,
    syncList,
    pending(i: Item) {
      const m = state.moves[itemKey(i)]
      if (!m) return ''
      return moveState(m, i.status, Date.now()) === 'expired'
        ? 'The bot did not apply the move to ' + names[m.target]
        : 'Move to ' + names[m.target] + ' requested'
    },
  }
}
