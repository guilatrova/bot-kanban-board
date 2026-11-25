import { buildBoard, toggleBot } from '../src/core/board'
import { botKey, itemKey, prKey, statuses, type Status, type Item, type MappedPr } from '../src/core/model'
import type { Snapshot } from '../src/protocol'
import { el, button, age, labels, badge, prState, describeFailure, notice, external } from './dom'
import { drawers } from './drawer'
import { mergeDialog } from './merge-dialog'
type Row = Item | MappedPr
import { views, type readViews } from './views'
import { itemActions, type readActions } from './item-actions'
export function view(saved: Awaited<ReturnType<typeof readViews>>, store: Awaited<ReturnType<typeof readActions>>) {
  let snapshot: Snapshot | undefined
  const redraw = () => {
    if (snapshot) draw(snapshot)
  }
  const update = () => {
    void orca.storage.set('views', saved).catch(notice)
    redraw()
  }
  const controls = views(saved, update)
  const actions = itemActions(store, redraw)
  let sleeping: Item[] = []
  const snoozed = button('Snoozed 0', () => actions.showList(sleeping), 'chip')
  const demo = el('mark', 'Demo data')
  const header = el('header'),
    hosts = el('div', '', 'chips'),
    filters = el('nav', '', 'chips'),
    updated = el('small'),
    lanes = el('main'),
    message = el('div', '', 'message')
  header.append(
    el('h1', 'Bots board'),
    demo,
    hosts,
    controls.trigger,
    snoozed,
    updated,
    button('↻ Refresh', () => orca.plugin.request('board.refresh')),
  )
  document.body.append(header, filters, message, lanes)
  const confirm = mergeDialog()
  const openMerge = (pr: MappedPr) => confirm(pr, snapshot?.error || snapshot?.repos[pr.repo])
  const drawer = drawers(openMerge, actions.selector)
  let dragging: MappedPr | null = null
  let draggedItem: Item | null = null
  const dock = el('aside', '', 'dock')
  dock.hidden = true
  document.body.append(dock)
  for (const target of ['done', 'snooze', 'canceled'] as const) {
    const zone = el('div', { done: 'Done', snooze: 'Snooze…', canceled: 'Cancel' }[target])
    zone.ondragover = (e) => {
      if (draggedItem) e.preventDefault()
    }
    zone.ondrop = (e) => {
      e.preventDefault()
      const item = draggedItem
      resetDrag()
      if (item) {
        if (target === 'snooze') actions.menu(item, true)
        else actions.move(item, target)
      }
    }
    dock.append(zone)
  }
  const resetDrag = () => {
    dragging = null
    draggedItem = null
    dock.hidden = true
    lanes.classList.remove('drag-item')
    lanes.classList.remove('drag-pr')
  }
  const columns = new Map<string, { lane: HTMLElement; heading: HTMLElement; list: HTMLElement }>()
  for (const [key, title] of Object.entries(labels)) {
    const lane = el('section', '', 'lane'),
      heading = el('h2', title),
      list = el('div', '', 'list')
    lane.dataset.key = key
    lane.style.setProperty('--tone', 'var(--' + key + ')')
    lane.append(heading, list)
    if (statuses.includes(key as Status)) {
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
    if (key === 'merged') {
      lane.insertBefore(el('p', 'Drop to review and confirm', 'drop-prompt'), list)
      lane.ondragover = (e) => {
        if (dragging) e.preventDefault()
      }
      lane.ondrop = (e) => {
        e.preventDefault()
        const pr = dragging
        resetDrag()
        if (pr) openMerge(pr)
      }
    }
    lanes.append(lane)
    columns.set(key, { lane, heading, list })
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
    columns.get('needs_you')?.lane.scrollIntoView({ block: 'nearest', inline: 'center' })
    columns.get('needs_you')?.list.querySelector('article')?.focus()
  }
  function draw(data: Snapshot) {
    snapshot = data
    demo.hidden = !data.demo
    const selected = new Set(saved.current.bots === 'all' ? [] : saved.current.bots)
    actions.reconcile(data.computers.flatMap((c) => (c.source.ok ? c.source.value.items : [])))
    const board = buildBoard(data.computers, data.prs, saved.current)
    sleeping = board.columns.flatMap((c) => c.items.filter(actions.sleep))
    for (const c of board.columns) c.items = c.items.filter((i) => !actions.sleep(i))
    snoozed.textContent = 'Snoozed ' + sleeping.length
    actions.syncList(sleeping)
    const prs = [...board.ready, ...board.draft, ...board.unmapped],
      trees = data.computers.flatMap((c) => (c.source.ok ? c.source.value.workspaces : []))
    updated.textContent = data.itemsAt ? 'Read ' + age(data.itemsAt) : ''
    hosts.replaceChildren(
      ...board.computers.map((c) => {
        const chip = el('span', c.name + ' · ' + (c.error ? 'Unreachable' : c.count), 'chip')
        if (c.error) chip.append(el('small', describeFailure(c.error)))
        return chip
      }),
    )
    controls.sync([...data.prs.map((p) => p.repo), ...trees.map((w) => w.repo), ...data.merged.map((p) => p.repo)])
    filters.replaceChildren(
      controls.repos,
      controls.needs,
      ...board.bots.map((b) => {
        const key = botKey(b.computer, b.name)
        const chip = button(
          b.name + ' ' + b.count,
          (e) => {
            const all = board.bots.map((b) => botKey(b.computer, b.name))
            const bots = [...toggleBot(selected, all, key, e.altKey || e.metaKey)]
            saved.current = { ...saved.current, name: '', bots: bots.length ? bots : 'all' }
            update()
          },
          'chip',
        )
        chip.prepend(badge(b.computer, b.name))
        chip.setAttribute('aria-pressed', String(!selected.size || selected.has(key)))
        return chip
      }),
    )
    message.textContent =
      data.itemsAt && !board.bots.length && board.computers.every((c) => !c.error)
        ? 'No bots yet. Open Items will appear here when a bot creates one.'
        : ''
    const alive = new Set<string>()
    function card(row: Row) {
      const isItem = 'status' in row,
        key = isItem ? itemKey(row) : prKey(row)
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
        links.map((l) => ('status' in l ? itemKey(l) : prKey(l))),
        age(row.updated),
        isItem && actions.pending(row),
      ])
      const open = () => (isItem ? drawer.item(row, prs, trees, element) : drawer.pr(row, element))
      if (isItem) {
        node.draggable = true
        node.oncontextmenu = (e) => {
          e.preventDefault()
          actions.menu(row)
        }
        node.ondragstart = (e) => {
          draggedItem = row
          e.dataTransfer?.setData('text/plain', key)
          lanes.classList.add('drag-item')
          dock.hidden = false
        }
        node.ondragend = resetDrag
      } else {
        node.draggable = true
        node.ondragstart = (e) => {
          dragging = row
          e.dataTransfer?.setData('text/plain', key)
          lanes.classList.add('drag-pr')
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
        meta.append(el('small', by?.bot ?? 'No bot'), el('time', age(row.updated)))
        node.append(meta, el('small', isItem ? 'Item #' + row.number : prKey(row)), el('h3', row.title))
        if (isItem) {
          const more = button(
            'More',
            (e) => {
              e.stopPropagation()
              actions.menu(row)
            },
            'more',
          )
          meta.append(more)
          const pending = actions.pending(row)
          if (pending) node.append(el('mark', pending))
          const sub =
            row.status === 'needs_you'
              ? row.question
              : row.status === 'waiting'
                ? row.wait
                : row.workers.findLast((w) => w.subject)?.subject
          if (sub) node.append(el('p', sub))
          const active = row.workers.find((w) => w.state === 'working')
          if (active) node.append(el('mark', '● ' + active.title))
          if (row.chat) node.append(el('small', row.chat))
        } else
          node.append(
            el('mark', prState(row)),
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
    for (const [key, { lane, heading, list }] of columns) {
      const column = board.columns.find((c) => c.status === key)
      lane.hidden = key === 'planned' && !column
      let nodes: HTMLElement[] = []
      if (key === 'prs') {
        heading.textContent = labels.prs + ' · ' + prs.length
        if (data.error) {
          prError.textContent = [describeFailure(data.error), data.prsAt ? 'Last read ' + age(data.prsAt) : '']
            .filter(Boolean)
            .join(' · ')
          nodes.push(prError)
        }
        nodes.push(...board.ready.map(card))
        if (board.draft.length) nodes.push(drafts, ...board.draft.map(card))
        if (board.unmapped.length || data.total > data.prs.length) {
          summary.textContent = 'No bot · ' + board.unmapped.length + ' shown of ' + data.total + ' open'
          patch(unmapped, board.unmapped.map(card))
          nodes.push(group)
        }
      } else if (key === 'merged') {
        const history = data.merged.filter(
          (p) =>
            !saved.current.needsMeOnly &&
            !selected.size &&
            (saved.current.repos === 'all' || saved.current.repos.includes(p.repo)),
        )
        heading.textContent = 'Merged · ' + history.length
        const error = data.error || data.mergedError
        if (error) nodes.push(el('p', describeFailure(error)))
        for (const row of history) {
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
        heading.textContent = labels[column.status] + ' · ' + column.items.length
        nodes = column.items.map(card)
      }
      const reading = key === 'prs' || key === 'merged' ? !data.prsAt && !data.error : !data.itemsAt
      patch(list, nodes.length ? nodes : reading ? [el('div', '', 'skeleton')] : [el('p', 'Nothing here.', 'empty')])
    }
    for (const key of cards.keys())
      if (!alive.has(key)) {
        cards.delete(key)
        signatures.delete(key)
      }
    if (data.focus) focus()
  }
  return { draw, focus }
}
