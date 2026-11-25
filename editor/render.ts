import { cardMotion } from './card-motion'
import { buildBoard } from '../src/core/board'
import { itemKey, prKey, isClosed, statuses, type Status, type Item, type MappedPr } from '../src/core/model'
import type { Snapshot } from '../src/protocol'
import { el, button, age, badge, prPill, describeFailure, notice, external, labels } from './dom'
import { drawers } from './drawer'
import { mergeDialog } from './merge-dialog'
import { laneKeys, makeLane, divider, icon, type Lane } from './lanes'
import { boardHeader } from './header'
import type { Bell } from '../src/core/bells'
type Row = Item | MappedPr
import { type readViews } from './views'
import { itemActions, type readActions } from './item-actions'
export function view(
  saved: Awaited<ReturnType<typeof readViews>>,
  store: Awaited<ReturnType<typeof readActions>>,
  collapsed: Set<string>,
) {
  let snapshot: Snapshot | undefined
  const redraw = () => {
    if (snapshot) draw(snapshot)
  }
  const update = () => {
    void orca.storage.set(snapshot?.demo ? 'demo-views' : 'views', saved).catch(notice)
    redraw()
  }
  const actions = itemActions(store, redraw)
  let sleeping: Item[] = []
  const snoozed = button('Snoozed 0', () => actions.showList(sleeping), 'chip')
  const header = boardHeader(saved, update, snoozed)
  const { lanes } = header
  const confirm = mergeDialog()
  const openMerge = (pr: MappedPr) => confirm(pr, snapshot?.error || snapshot?.repos[pr.repo])
  const drawer = drawers(openMerge, actions.selector)
  let dragging: MappedPr | null = null
  let draggedItem: Item | null = null
  const columns = new Map<Lane, ReturnType<typeof makeLane>>()
  function dragTarget(key: 'merged' | 'closed', on: boolean) {
    const col = columns.get(key)
    if (!on) col?.lane.querySelector('.over')?.classList.remove('over')
    col?.expandForDrag(on)
    col?.lane.classList.toggle('target', on)
  }
  function resetDrag() {
    dragging = null
    draggedItem = null
    dragTarget('closed', false)
    dragTarget('merged', false)
  }
  for (const key of laneKeys) {
    const col = makeLane(key, collapsed, () => orca.storage.set('collapsed', [...collapsed]))
    const { lane, list } = col
    if (key === 'prs') lanes.append(divider())
    lanes.append(lane)
    columns.set(key, col)
    if (statuses.some((s) => s === key)) {
      lane.ondragover = (e) => {
        if (draggedItem) e.preventDefault()
      }
      lane.ondrop = (e) => {
        e.preventDefault()
        const item = draggedItem
        resetDrag()
        if (item) actions.move(item, key as Status)
      }
    }
    if (key === 'closed' || key === 'merged') {
      const split = el('div', '', 'split')
      const targets = key === 'closed' ? (['done', 'canceled'] as const) : (['merge', 'close'] as const)
      for (const target of targets) {
        const title = target === 'merge' ? 'Merge' : target === 'close' ? 'Close PR' : labels[target]
        const zone = el('div', title, 'zone')
        zone.classList.toggle('danger', target === 'canceled' || target === 'close')
        zone.ondragover = (e) => {
          if (key === 'closed' ? draggedItem : dragging) {
            e.preventDefault()
            zone.classList.add('over')
          }
        }
        zone.ondragleave = () => zone.classList.remove('over')
        zone.ondrop = (e) => {
          e.preventDefault()
          const item = draggedItem,
            pr = dragging
          resetDrag()
          if (item && (target === 'done' || target === 'canceled')) actions.move(item, target)
          if (pr && target === 'merge') openMerge(pr)
          if (pr && target === 'close') confirm(pr, undefined, true)
        }
        split.append(zone)
      }
      lane.append(split)
    }
    for (let n = 0; n < 3; n++) list.append(el('div', '', 'skeleton'))
  }
  const cards = new Map<string, HTMLElement>(),
    signatures = new Map<string, string>()
  const group = el('details'),
    summary = el('summary'),
    unmapped = el('div')
  group.append(summary, unmapped)
  const drafts = el('h3', 'Draft'),
    prError = el('p')
  function focus() {
    const heading = columns.get('needs_you')?.lane.querySelector('h2')
    if (heading?.getAttribute('aria-expanded') === 'false') heading.click()
    columns.get('needs_you')?.lane.scrollIntoView({ block: 'nearest', inline: 'center' })
    columns.get('needs_you')?.list.querySelector('article')?.focus()
  }
  function draw(data: Snapshot) {
    snapshot = data
    actions.reconcile(
      data.computers.flatMap((c) => (c.source.ok ? c.source.value.items : [])),
      Object.assign({}, ...data.computers.map((c) => (c.source.ok ? c.source.value.closed : {}))),
    )
    const board = buildBoard(data.computers, data.prs, saved.current, data.merged)
    sleeping = board.columns.flatMap((c) => c.items.filter(actions.sleep))
    for (const c of board.columns) c.items = c.items.filter((i) => !actions.sleep(i))
    snoozed.textContent = 'Snoozed ' + sleeping.length
    actions.syncList(sleeping)
    const prs = [...board.ready, ...board.draft, ...board.unmapped],
      trees = data.computers.flatMap((c) => (c.source.ok ? c.source.value.workspaces : []))
    header.draw(data, board, trees)
    const animate = cardMotion(cards)
    const alive = new Set<string>()
    function card(row: Row) {
      const isItem = 'status' in row,
        closed = isItem && isClosed(row.status),
        key = isItem ? itemKey(row) : prKey(row)
      const bell: Bell = isItem ? { kind: 'item', id: key, baseline: row.status } : { kind: 'pr', id: key }
      const ringing = data.bells?.some((b) => b.id === key) ?? false
      alive.add(key)
      let node = cards.get(key)
      if (!node) {
        node = el('article')
        node.tabIndex = 0
        cards.set(key, node)
      }
      const element = node
      const links = isItem ? prs.filter((p) => p.items.some((i) => itemKey(i) === key)) : row.items
      const signature = JSON.stringify([
        row,
        ringing,
        data.notificationsOff,
        links.map((l) => ('status' in l ? itemKey(l) : prKey(l))),
        age(row.updated),
        isItem && actions.pending(row),
      ])
      const open = () => (isItem ? drawer.item(row, prs, trees, element) : drawer.pr(row, element))
      if (isItem) {
        node.draggable = !closed
        node.oncontextmenu = (e) => {
          e.preventDefault()
          const anchor = element.querySelector<HTMLElement>('.more')
          if (anchor) actions.menu(row, anchor)
        }
        node.ondragstart = (e) => {
          draggedItem = row
          e.dataTransfer?.setData('text/plain', key)
          dragTarget('closed', true)
        }
        node.ondragend = resetDrag
      } else {
        node.draggable = true
        node.ondragstart = (e) => {
          dragging = row
          e.dataTransfer?.setData('text/plain', key)
          dragTarget('merged', true)
        }
        node.ondragend = resetDrag
      }
      node.onclick = open
      node.onkeydown = (e) => {
        if (e.target === element && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }
      if (signatures.get(key) !== signature) {
        signatures.set(key, signature)
        node.replaceChildren()
        const by = isItem ? row : (row.items[0] ?? row.workspaces[0])
        const meta = el('div', '', 'meta')
        if (by) meta.append(badge(by.computer, by.bot))
        meta.append(
          el('small', by?.bot ?? 'No bot'),
          el('small', isItem ? 'Item #' + row.number : prKey(row), 'ref'),
          el('time', age(row.updated)),
        )
        node.append(meta, el('h3', row.title))
        if (!closed) {
          const toggle = button(
            '',
            (e) => {
              e.stopPropagation()
              return orca.plugin.request('bell.set', { bell, on: !ringing })
            },
            'bell',
          )
          toggle.append(icon('M4 17h16l-2-3V9a6 6 0 0 0-12 0v5zM10 20a2 2 0 0 0 4 0'))
          toggle.setAttribute('aria-label', 'Notify me')
          toggle.setAttribute('aria-pressed', String(ringing))
          meta.append(toggle)
          if (ringing && data.notificationsOff)
            node.append(
              el(
                'small',
                'Notifications for Orca are off. Turn them on in System Settings › Notifications › Orca.',
                'bell-note',
              ),
            )
        }
        if (isItem) {
          if (closed || row.status === 'planned') node.append(el('mark', labels[row.status]))
          const more = button(
            '',
            (e) => {
              e.stopPropagation()
              actions.menu(row, more)
            },
            'more',
          )
          more.setAttribute('aria-label', 'More')
          if (!closed) meta.append(more)
          const pending = actions.pending(row)
          if (pending) node.append(el('mark', pending))
          const sub =
            row.status === 'needs_you'
              ? row.question
              : row.status === 'waiting'
                ? row.wait
                : row.workers.findLast((w) => w.subject)?.subject
          if (sub) node.append(el('p', sub, 'quote'))
          const active = row.workers.find((w) => w.state === 'working')
          if (active) node.append(el('mark', '● ' + active.title, 'running'))
          if (row.chat) node.append(el('small', row.chat))
        } else
          node.append(
            prPill(row),
            el(
              'small',
              ['+' + row.additions + ' −' + row.deletions, row.files + ' files', row.checks]
                .filter(Boolean)
                .join(' · '),
            ),
          )
        if (!isItem && row.behind) node.append(el('p', 'Behind ' + row.behind))
        for (const link of links) {
          const item = 'status' in link,
            k = item ? itemKey(link) : prKey(link)
          node.append(
            button(
              item ? link.bot + ' #' + link.number : k,
              (e) => {
                e.stopPropagation()
                const target = cards.get(k)
                target?.scrollIntoView({ block: 'nearest' })
                target?.focus()
              },
              'link',
            ),
          )
        }
      }
      return node
    }
    function patch(parent: HTMLElement, children: HTMLElement[]) {
      for (const [index, node] of children.entries()) {
        if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null)
      }
      while (parent.children.length > children.length) parent.lastElementChild?.remove()
    }
    for (const [key, col] of columns) {
      const { list } = col
      const column = board.columns.find((c) => c.status === key)

      let nodes: HTMLElement[] = []
      if (key === 'prs') {
        col.update(
          prs.length,
          prs.flatMap((p) => [...p.items, ...p.workspaces]),
        )
        if (data.error) {
          prError.textContent = [describeFailure(data.error), data.prsAt ? 'Last read ' + age(data.prsAt) : '']
            .filter(Boolean)
            .join(' · ')
          nodes.push(prError)
        }
        // Keep the familiar groups unless they place a base after its dependent.
        const positions = new Map(prs.map((pr, index) => [prKey(pr), index]))
        const splitStack = prs.some((pr, index) => pr.behind && (positions.get(pr.behind) ?? -1) > index)
        if (splitStack) {
          nodes.push(...board.ordered.map(card))
          if (data.total > data.prs.length)
            nodes.push(el('small', data.prs.length + ' loaded of ' + data.total + ' open'))
        } else {
          nodes.push(...board.ready.map(card))
          if (board.draft.length) nodes.push(drafts, ...board.draft.map(card))
          if (board.unmapped.length || data.total > data.prs.length) {
            summary.textContent = 'No bot · ' + board.unmapped.length + ' shown of ' + data.total + ' open'
            patch(unmapped, board.unmapped.map(card))
            nodes.push(group)
          }
        }
      } else if (key === 'merged') {
        col.update(board.merged.length, [])
        const error = data.error || data.mergedError
        if (error) nodes.push(el('p', describeFailure(error)))
        for (const row of board.merged) {
          const key = 'merged:' + prKey(row)
          alive.add(key)
          let node = cards.get(key)
          if (!node) {
            node = external('', row.url)
            node.className = 'merged-card'
            if (row.notification) node.classList.add('landed')
            cards.set(key, node)
          }
          node.replaceChildren(el('small', prKey(row) + ' · ' + age(row.mergedAt)), el('h3', row.title))
          if (row.notification) node.append(el('small', row.notification))
          nodes.push(node)
        }
      } else if (column) {
        col.update(column.items.length, column.items)
        nodes = column.items.map(card)
      }
      const reading = key === 'prs' || key === 'merged' ? !data.prsAt && !data.error : !data.itemsAt
      patch(list, nodes.length ? nodes : reading ? [el('div', '', 'skeleton')] : [col.empty])
    }
    for (const key of cards.keys())
      if (!alive.has(key)) {
        cards.delete(key)
        signatures.delete(key)
      }
    animate(alive)
    if (data.focus) focus()
  }
  return { draw, focus }
}
