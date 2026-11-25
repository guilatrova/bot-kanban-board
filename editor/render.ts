import { mergeToasts } from './merge-toasts'
import { settings, type readMergeSettings } from './settings'
import { land, mergedRow } from './merge-landing'
import { dropZones } from './drop-zones'
import { selection, buildDeck } from './selection'
import { mergeQueue } from './merge-queue'
import { type MergedPr } from '../src/core/merge'
import { prStats } from './pr-labels'
import { cardMotion } from './card-motion'
import { buildBoard } from '../src/core/board'
import { itemKey, prKey, isClosed, type Item, type MappedPr } from '../src/core/model'
import type { Snapshot } from '../src/protocol'
import { patch, el, button, age, badge, prPill, notice, labels } from './dom'
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
  { prefs, save }: Awaited<ReturnType<typeof readMergeSettings>>,
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
  const gear = settings(
    prefs,
    () => {
      save()
      redraw()
    },
    () => snapshot?.computers ?? [],
  )
  const header = boardHeader(saved, update, snoozed, gear)
  const { lanes } = header
  const confirm = mergeDialog(prefs, save)
  const notify = mergeToasts(prefs, gear)
  let landing = false
  const landed = new Map<string, MergedPr>()
  async function arrive(row: MergedPr) {
    const key = prKey(row),
      col = columns.get('merged')!,
      node = mergedRow(row)
    landing = true
    try {
      await land(col.list, cards.get(key), node, () => {
        cards.set('merged:' + key, node)
        cards.delete(key)
        signatures.delete(key)
        landed.set(key, row)
      })
    } finally {
      landing = false
    }
    redraw()
  }
  const queue = mergeQueue(
    prefs,
    confirm,
    (pr) =>
      arrive(snapshot?.merged.find((row) => prKey(row) === prKey(pr)) ?? { ...pr, mergedAt: new Date().toISOString() }),
    notify,
    redraw,
  )
  function start(prs: MappedPr[]) {
    if (queue.busy) return
    select.clear()
    void queue.start(prs).catch(notice)
  }
  const drawer = drawers((pr) => start([pr]), actions.selector)
  const columns = new Map<Lane, ReturnType<typeof makeLane>>()
  const zones = dropZones(columns, queue.panel, actions.move, start, (pr) => confirm(pr, undefined, true))
  for (const key of laneKeys) {
    const col = makeLane(key, collapsed, () => orca.storage.set('collapsed', [...collapsed]))
    const { lane } = col
    if (key === 'prs') lanes.append(divider())
    lanes.append(lane)
    columns.set(key, col)
    zones.attach(key, lane)
  }
  const cards = new Map<string, HTMLElement>(),
    signatures = new Map<string, string>()
  const select = selection(columns.get('prs')!.lane, cards, start)
  columns.get('merged')!.list.before(queue.panel)
  const group = el('details'),
    summary = el('summary'),
    unmapped = el('div')
  group.append(summary, unmapped)
  const drafts = el('h3', 'Draft')
  function focus() {
    const heading = columns.get('needs_you')?.lane.querySelector('h2')
    if (heading?.getAttribute('aria-expanded') === 'false') heading.click()
    columns.get('needs_you')?.lane.scrollIntoView({ block: 'nearest', inline: 'center' })
    columns.get('needs_you')?.list.querySelector('article')?.focus()
  }
  function draw(data: Snapshot) {
    snapshot = data
    if (
      landing ||
      (queue.active &&
        !landed.has(queue.active) &&
        data.merged.some((p) => prKey(p) === queue.active) &&
        cards.has(queue.active))
    )
      return
    const backgroundRow = data.merged.find((row) => cards.has(prKey(row)))
    if (backgroundRow && !queue.busy) {
      void arrive(backgroundRow).catch(notice)
      return
    }
    for (const k of landed.keys()) if (data.merged.some((p) => prKey(p) === k)) landed.delete(k)
    if (landed.size)
      data = {
        ...data,
        prs: data.prs.filter((p) => !landed.has(prKey(p))),
        merged: [...landed.values(), ...data.merged],
      }
    const mergedColumn = columns.get('merged')!
    mergedColumn.expandForDrag(queue.panel.classList.contains('on') || mergedColumn.lane.classList.contains('target'))
    select.go.disabled = queue.busy
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
      const merging = !isItem && !!data.running?.includes(key)
      node.inert = merging
      node.classList.toggle('merging', merging)
      const signature = JSON.stringify([
        row,
        merging,
        ringing,
        prefs.compact,
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
          if (!closed) actions.menu(row, anchor ?? element)
        }
        node.ondragstart = (e) => {
          zones.item(row)
          e.dataTransfer?.setData('text/plain', key)
        }
        node.ondragend = zones.resetDrag
      } else {
        node.draggable = !queue.busy
        node.ondragstart = (e) => {
          if (queue.busy) {
            e.preventDefault()
            return
          }
          const dragging = select.batch(row)
          zones.prs(dragging, buildDeck(dragging, cards, e))
          e.dataTransfer?.setData('text/plain', key)
        }
        node.ondragend = zones.resetDrag
      }
      node.onclick = (e) => {
        if (isItem || !select.click(e, key)) open()
      }
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
        node.classList.toggle('compact-card', prefs.compact)
        node.title = prefs.compact ? (by?.bot ?? 'No bot') + ' · ' + row.title : ''
        if (prefs.compact) {
          node.append(
            by ? badge(by.computer, by.bot) : el('span', '—', 'avatar'),
            el('span', row.title, 'compact-title'),
          )
          if (!isItem && row.draft) node.append(el('span', 'Draft', 'compact-draft'))
          node.append(el('time', age(row.updated)))
          return node
        }
        const meta = el('div', '', 'meta')
        if (by) meta.append(badge(by.computer, by.bot))
        meta.append(
          el('small', by?.bot ?? 'No bot'),
          el('small', isItem ? 'Item #' + row.number : prKey(row), 'ref'),
          el('time', age(row.updated)),
        )
        node.append(meta, el('h3', row.title))
        if (!isItem) node.append(select.checkbox(key))
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
        } else node.append(merging ? el('mark', 'Merging…', 'ready') : prPill(row), el('small', prStats(row)))
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
    for (const [key, col] of columns) {
      const { list } = col
      const column = board.columns.find((c) => c.status === key)

      let nodes: HTMLElement[] = []
      if (key === 'prs') {
        col.update(
          prs.length,
          prs.flatMap((p) => [...p.items, ...p.workspaces]),
        )
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
        for (const row of board.merged) {
          const key = 'merged:' + prKey(row)
          alive.add(key)
          let node = cards.get(key)
          if (!node) {
            node = mergedRow(row)
            cards.set(key, node)
          }
          node.querySelector('time')!.textContent = age(row.mergedAt)
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
    select.draw(prs)
    animate(alive)
    if (data.focus) {
      focus()
      data.focus = false
    }
  }
  return { draw, focus }
}
