import { type Board, toggleBot } from '../src/core/board'
import { botKey, type Workspace } from '../src/core/model'
import type { Snapshot } from '../src/protocol'
import { el, button, age, badge, describeFailure } from './dom'
import { views, type readViews } from './views'
import { popover } from './popover'
import { icon } from './lanes'
export function boardHeader(
  saved: Awaited<ReturnType<typeof readViews>>,
  update: () => void,
  snoozed: HTMLButtonElement,
  gear: HTMLButtonElement,
) {
  const controls = views(saved, update)
  const demo = el('mark', 'Demo data')
  const header = el('header'),
    hosts = el('div', '', 'chips'),
    filters = el('div', '', 'chips bot-chips'),
    updated = button('', () => orca.plugin.request('board.refresh'), 'stamp'),
    unreachable = el('div', '', 'chips'),
    lanes = el('main'),
    message = el('div', '', 'message')
  let popup: ReturnType<typeof popover> | undefined
  const filter = button(
    '',
    () => {
      if (popup?.node.isConnected) {
        popup.close(true)
        return
      }
      popup = popover(filter)
      popup.node.append(
        controls.trigger,
        controls.needs,
        snoozed,
        controls.repos,
        el('div', 'Computers', 'mlabel'),
        hosts,
      )
      popup.position()
    },
    'ico',
  )
  filter.append(icon('M3 5h18M6 12h12M10 19h4'))
  filter.setAttribute('aria-label', 'Filters')
  updated.setAttribute('aria-label', 'Refresh board')
  const brand = el('h1', 'Bot Kanban Board', 'brand')
  brand.prepend(icon('M2 2h3.6v12H2zM6.7 2h3.6v8H6.7zM11.4 2H15v5h-3.6z', 16))
  const tools = el('div', '', 'header-tools')
  const openCount = el('span')
  tools.append(openCount, updated, filter, gear)
  header.append(brand, demo, el('span', '', 'sep'), filters, unreachable, tools)
  document.body.append(header, message, lanes)

  return {
    lanes,
    draw(data: Snapshot, board: Board, trees: Workspace[]) {
      openCount.hidden = data.total <= data.prs.length
      openCount.textContent = openCount.hidden ? '' : data.prs.length + ' of ' + data.total
      demo.hidden = !data.demo
      const selected = board.selected
      updated.replaceChildren(el('span', '', 'live'), data.itemsAt ? 'Read ' + age(data.itemsAt) : 'Reading…')
      unreachable.replaceChildren()
      hosts.replaceChildren(
        ...board.computers.map((c) => {
          const chip = el('span', c.name + ' · ' + (c.unreachable ? 'Unreachable' : c.count), 'chip')
          if (c.error) chip.append(el('small', describeFailure(c.error)))
          if (c.warning) chip.append(el('small', describeFailure(c.warning)))
          if (c.unreachable) unreachable.append(chip.cloneNode(true))
          return chip
        }),
      )
      controls.sync([...data.prs.map((p) => p.repo), ...trees.map((w) => w.repo), ...data.merged.map((p) => p.repo)])
      filters.replaceChildren(
        ...board.chips.map((b) => {
          const key = botKey(b.computer, b.name)
          function toggle(solo: boolean) {
            const all = board.chips.map((b) => botKey(b.computer, b.name))
            const bots = [...toggleBot(selected, all, key, solo)]
            saved.current = { ...saved.current, name: '', bots: bots.length ? bots : 'all' }
            update()
          }
          const chip = button(b.name + ' ' + b.cards, (e) => toggle(e.altKey || e.metaKey), 'chip')
          chip.classList.toggle('solo', selected.size === 1 && selected.has(key))
          chip.oncontextmenu = (e) => {
            e.preventDefault()
            toggle(true)
          }
          const tip = el(
            'span',
            'Click to hide · Right-click or ⌥-click to show only ' + b.name + "'s cards, merges included",
            'chip-tip',
          )
          chip.append(tip)
          chip.onmouseenter = () => {
            const r = chip.getBoundingClientRect()
            tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + 'px'
            tip.style.top = Math.min(innerHeight - tip.offsetHeight - 8, r.bottom + 8) + 'px'
          }
          chip.prepend(badge(b.computer, b.name))
          if (b.warning) chip.append(el('small', describeFailure(b.warning)))
          chip.setAttribute('aria-pressed', String(!selected.size || selected.has(key)))
          return chip
        }),
      )
      const warnings = board.bots.flatMap((b) =>
        b.warning && !b.chip ? [b.name + ' · ' + describeFailure(b.warning)] : [],
      )
      message.textContent =
        data.banner ??
        (data.itemsAt && !board.bots.length && board.computers.every((c) => !c.error && !c.warning)
          ? 'No bots yet. Open Items will appear here when a bot creates one.'
          : warnings.join(' · '))
    },
  }
}
