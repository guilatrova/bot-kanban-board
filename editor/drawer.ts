import { el, button, age, labels, notice, prPill, external, badge } from './dom'
import { countLabel } from './pr-labels'
import { showFiles } from './diff'
import { isClosed, itemKey, prKey, type Item, type MappedPr, type Workspace } from '../src/core/model'
export function drawers(openMerge: (p: MappedPr) => void, statusSelector: (i: Item) => HTMLElement) {
  const dialog = el('dialog'),
    body = el('section'),
    close = button('Close', () => dialog.close())
  dialog.append(close, body)
  document.body.append(dialog)
  let origin: HTMLElement | null = null
  dialog.addEventListener('close', () => origin?.focus())
  dialog.onclick = (e) => {
    if (e.target === dialog && e.clientX < dialog.getBoundingClientRect().left) dialog.close()
  }
  function open(card: HTMLElement) {
    if (!dialog.open) {
      origin = card
      dialog.showModal()
    }
    body.replaceChildren()
    dialog.scrollTop = 0
  }
  function section(label: string, text: string | null) {
    if (text) body.append(el('h3', label), el('p', text))
  }
  function workspace(w: Workspace) {
    body.append(
      button('Open ' + w.name, async () =>
        notice(await orca.plugin.request('board.jump', { computer: w.computer, bot: w.bot, workspace: w.id })),
      ),
    )
  }
  function item(i: Item, prs: MappedPr[], trees: Workspace[], card: HTMLElement) {
    open(card)
    body.style.setProperty('--tone', 'var(--' + i.status + ')')
    body.append(
      badge(i.computer, i.bot),
      el('small', i.bot + ' · Item #' + i.number + ' · ' + age(i.updated)),
      el('h2', i.title),
      el('mark', labels[i.status]),
      ...(isClosed(i.status) ? [] : [statusSelector(i)]),
    )
    const answer = async () =>
      notice(await orca.plugin.request('board.jump', { computer: i.computer, bot: i.bot, number: i.number }))
    if (i.status === 'needs_you') {
      section('Question', i.question)
      for (const opt of i.options) body.append(el('p', opt, 'option'))
      body.append(button('Answer in Orca', answer))
    }
    section('Waiting on', i.wait)
    section('Description', i.description)
    section('Done means', i.done)
    const report = i.workers.findLast((w) => w.subject || w.body)
    if (report) section('Latest worker report', [report.subject, report.body].filter(Boolean).join('\n'))
    if (i.workers.length) {
      body.append(el('h3', 'Workers'))
      for (const w of i.workers) {
        body.append(el('p', [w.title, w.state].filter(Boolean).join(' · ')))
        const tree = trees.find(
          (t) => t.computer === i.computer && t.bot === i.bot && (w.workspace === t.id || w.workspace === t.name),
        )
        if (tree) workspace(tree)
      }
    }
    for (const p of prs.filter((p) => p.items.some((m) => itemKey(m) === itemKey(i))))
      body.append(button('View diff · ' + prKey(p), () => pr(p, card)))
    body.append(button('Open chat in Orca', answer))
    section('Chat', i.chat)
  }
  function pr(p: MappedPr, card: HTMLElement) {
    open(card)
    body.style.setProperty('--tone', 'var(--prs)')
    const match = p.items[0] ?? p.workspaces[0]
    if (match) body.append(badge(match.computer, match.bot), el('small', match.bot))
    body.append(
      el('small', prKey(p) + ' · ' + age(p.updated)),
      el('h2', p.title),
      prPill(p),
      el('p', '+' + p.additions + ' −' + p.deletions + ' · ' + countLabel(p.files, 'file'), 'diff-counts'),
      button(
        'Merge',
        () => {
          dialog.close()
          openMerge(p)
        },
        'merge-action',
      ),
      external('Files on GitHub', p.url + '/files'),
      external('Conversation on GitHub', p.url),
    )
    section('Stack', p.behind ? 'Behind ' + p.behind : null)
    section('Branch', p.head + ' → ' + p.base)
    section('Closes', p.closes.map(prKey).join(', '))
    if (p.how)
      section(
        'Matched by',
        {
          branch: 'The workspace branch matches this pull request.',
          item: 'An Item names this pull request.',
          issue: 'An Item names an issue this pull request closes.',
        }[p.how],
      )
    section('Items', p.items.map((i) => i.bot + ' #' + i.number + ' · ' + i.title).join('\n'))
    for (const w of p.workspaces) workspace(w)
    const files = el('div')
    body.append(el('h3', 'Changes'), files)
    void showFiles(files, p)
  }
  return { item, pr }
}
