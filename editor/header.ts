import { age } from '../src/core/presentation'
import { panelRequest } from './panel-request'
import { type Board, toggleSelection, noRepo } from '../src/core/board'
import { botKey } from '../src/core/model'
import type { Snapshot } from '../src/protocol'
import { el, button, badge, describeFailure } from './dom'
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
    updated = button('', () => panelRequest('board.refresh'), 'stamp'),
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
      popup.node.append(controls.trigger, controls.needs, snoozed, el('div', 'Computers', 'mlabel'), hosts)
      popup.position()
    },
    'ico',
  )
  let repoMenu: ReturnType<typeof popover> | undefined
  let repoRows: [string, number][] = []
  let activeRepos = new Set<string>()
  let ownerPrefix = ''
  let drawRepoMenu: (() => void) | undefined
  const displayName = (repo: string) => (repo === noRepo ? repo : repo.slice(ownerPrefix.length))
  const changeRepos = (selection: Set<string>) => {
    saved.current = { ...saved.current, name: '', repos: selection.size === repoRows.length ? 'all' : [...selection] }
    update()
  }
  const repoChip = button(
    '',
    () => {
      if (repoMenu?.node.isConnected) return repoMenu.close(true)
      const menu = popover(repoChip)
      repoMenu = menu
      menu.node.classList.add('repo-menu')
      const head = el('div', '', 'repo-head')
      const search = el('input', '', 'repo-search')
      search.placeholder = 'Search repos'
      search.setAttribute('aria-label', search.placeholder)
      const meta = el('div', '', 'repo-meta')
      const counter = el('span')
      const actions = el('span')
      actions.append(
        button('Select all', () => changeRepos(new Set(repoRows.map(([repo]) => repo)))),
        ' · ',
        button('Clear', () => changeRepos(new Set())),
      )
      meta.append(counter, actions)
      head.append(search, meta)
      const list = el('div', '', 'repo-list')
      list.setAttribute('role', 'menu')
      list.setAttribute('aria-label', 'Repositories')
      menu.node.append(head, list)
      drawRepoMenu = () => {
        const focused = document.activeElement?.closest<HTMLElement>('[data-repo]')?.dataset.repo
        counter.textContent = activeRepos.size + ' of ' + repoRows.length
        list.replaceChildren()
        const query = search.value.toLowerCase()
        for (const [repo, count] of repoRows) {
          const label = displayName(repo)
          if (!label.toLowerCase().includes(query)) continue
          const row = el('div', '', 'repo-option')
          row.tabIndex = 0
          row.dataset.repo = repo
          row.setAttribute('role', 'menuitemcheckbox')
          row.setAttribute('aria-checked', String(activeRepos.has(repo)))
          row.setAttribute('aria-label', label)
          row.onclick = () => {
            const next = new Set(activeRepos)
            if (!next.delete(repo)) next.add(repo)
            changeRepos(next)
          }
          row.onkeydown = (e) => {
            if (e.target === row && (e.key === ' ' || e.key === 'Enter')) {
              e.preventDefault()
              row.click()
            }
          }
          const name = el('span', label, 'repo-name')
          if (repo === noRepo) {
            list.append(el('hr'))
            name.classList.add('unassigned')
            const tip = el('span', 'ⓘ', 'info-tip')
            tip.tabIndex = 0
            tip.dataset.tip = 'Items without a linked PR or issue'
            tip.setAttribute('aria-label', tip.dataset.tip)
            name.append(tip)
          } else row.title = repo
          const only = button(
            'Only',
            (event) => {
              event.stopPropagation()
              changeRepos(new Set([repo]))
              menu.close(true)
            },
            'only',
          )
          row.append(el('span', '', 'checkbox-mark'), name, el('span', String(count), 'repo-count'), only)
          list.append(row)
          if (repo === focused) row.focus({ preventScroll: true })
        }
        if (!list.childElementCount) list.append(el('div', 'No repo matches “' + search.value + '”', 'repo-empty'))
        menu.position(false)
      }
      search.oninput = drawRepoMenu
      menu.node.addEventListener('dismiss', () => {
        drawRepoMenu = undefined
      })
      drawRepoMenu()
      search.focus()
    },
    'chip repo-chip',
  )
  filter.append(icon('M3 5h18M6 12h12M10 19h4'))
  filter.setAttribute('aria-label', 'Filters')
  updated.setAttribute('aria-label', 'Refresh board')
  const brand = el('h1', 'Bot Kanban Board', 'brand')
  brand.prepend(icon('M2 2h3.6v12H2zM6.7 2h3.6v8H6.7zM11.4 2H15v5h-3.6z', 16))
  const tools = el('div', '', 'header-tools')
  tools.append(updated, filter, gear)
  header.append(brand, demo, el('span', '', 'sep'), filters, el('span', '', 'sep'), repoChip, unreachable, tools)
  document.body.append(header, message, lanes)

  return {
    lanes,
    draw(data: Snapshot, board: Board) {
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
      controls.sync()
      repoRows = [...board.repos].sort(([a, ac], [b, bc]) =>
        a === noRepo ? 1 : b === noRepo ? -1 : bc - ac || a.localeCompare(b),
      )
      const real = repoRows.map(([repo]) => repo).filter((repo) => repo !== noRepo)
      const prefix = real[0]?.match(/^[^/]+\//)?.[0] ?? ''
      ownerPrefix = real.every((repo) => repo.startsWith(prefix)) ? prefix : ''
      activeRepos = new Set(repoRows.map(([repo]) => repo).filter(board.acceptsRepo))
      const value = !board.reposFiltered
        ? 'All'
        : activeRepos.size === 1
          ? displayName([...activeRepos][0]!)
          : String(activeRepos.size)
      repoChip.replaceChildren('Repos ', el('span', value), ' ▾')
      repoChip.classList.toggle('repo-filtered', board.reposFiltered)
      drawRepoMenu?.()
      filters.replaceChildren(
        ...board.chips.map((b) => {
          const key = botKey(b.computer, b.name)
          function toggle(solo: boolean) {
            const all = board.chips.map((b) => botKey(b.computer, b.name))
            const bots = [...toggleSelection(selected, all, key, solo)]
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
