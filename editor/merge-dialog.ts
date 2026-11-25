import { assessMerge, type RepositoryFacts, type MergeMethod } from '../src/core/merge'
import { prKey, type MappedPr, type Source } from '../src/core/model'
import { el, button, describeFailure, notice } from './dom'

const stepLabels = { ready: 'Mark ready', merge: 'Merge' }
export function mergeDialog() {
  const modal = el('dialog', '', 'merge-dialog')
  modal.setAttribute('aria-label', 'Confirm pull request merge')
  document.body.append(modal)
  let active = '',
    busy = false
  const steps = new Map<string, HTMLElement>()
  modal.oncancel = (e) => {
    if (busy) e.preventDefault()
  }
  modal.onclick = (e) => {
    const rect = modal.getBoundingClientRect()
    if (
      !busy &&
      e.target === modal &&
      (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
    )
      modal.close()
  }
  orca.plugin.on('merge.progress', (e) => {
    if (e.key !== active || !busy) return
    const node = steps.get(e.step)
    if (node) {
      node.dataset.state = e.state
      node.textContent = stepLabels[e.step] + ' · ' + e.state
    }
  })
  return (pr: MappedPr, facts?: Source<RepositoryFacts>, closing = false) => {
    if (modal.open) return
    active = prKey(pr)
    steps.clear()
    const actions = el('footer'),
      cancel = button('Cancel', () => modal.close()),
      summary = el('div', '', 'merge-facts')
    actions.append(cancel)
    modal.replaceChildren(el('small', active), el('h2', pr.title), summary, actions)
    modal.showModal()
    modal.setAttribute('aria-label', closing ? 'Confirm pull request close' : 'Confirm pull request merge')
    if (closing) {
      modal.replaceChildren(el('h2', 'Close ' + active + ' without merging?'), actions)
      actions.append(
        button(
          'Close PR',
          async () => {
            if (busy) return
            busy = true
            actions.inert = true
            try {
              const result = await orca.plugin.request('pr.close', { repo: pr.repo, number: pr.number })
              if (!result.ok) notice(describeFailure(result))
            } finally {
              busy = false
              actions.inert = false
              modal.close()
            }
          },
          'confirm danger',
        ),
      )
      return
    }
    if (pr.behind) summary.append(el('p', 'Merging out of order · ' + pr.behind + ' is still open.', 'warning'))
    if (!facts?.ok || !pr.sha) {
      summary.append(
        el('p', facts && !facts.ok ? describeFailure(facts) : 'Merge facts unavailable. Refresh the board.'),
      )
      return
    }
    const assessment = assessMerge(pr, facts.value)
    summary.append(
      el('p', pr.head + ' → ' + pr.base),
      el('p', [pr.mergeable, pr.checks || 'No checks', '+' + pr.additions + ' −' + pr.deletions].join(' · ')),
    )
    for (const w of assessment.warnings) summary.append(el('p', w.text, w.danger ? 'warning danger' : 'warning'))
    for (const blocker of assessment.blockers) summary.append(el('p', blocker, 'warning'))
    if (!assessment.canMerge) return
    const select = el('select'),
      label = el('label', 'Merge method ')
    for (const m of assessment.methods) {
      const opt = el('option', { squash: 'Squash', merge: 'Merge commit', rebase: 'Rebase' }[m])
      opt.selected = m === assessment.defaultMethod
      opt.value = m
      select.append(opt)
    }
    label.append(select)
    summary.append(label)
    const sha = pr.sha
    actions.append(
      button(
        'Confirm merge',
        async () => {
          if (busy) return
          busy = true
          const progress = el('div', '', 'merge-steps')
          progress.setAttribute('aria-live', 'polite')
          for (const step of pr.draft ? (['ready', 'merge'] as const) : (['merge'] as const)) {
            const node = el('p', stepLabels[step] + ' · waiting')
            steps.set(step, node)
            progress.append(node)
          }
          actions.replaceChildren(progress)
          select.disabled = true
          try {
            const result = await orca.plugin.request(
              'pr.merge',
              { repo: pr.repo, number: pr.number, updated: pr.updated, sha, method: select.value as MergeMethod },
              { timeoutMs: 120000 },
            )
            if (result.ok) {
              modal.close()
              return
            }
            if (steps.get('ready')?.dataset.state === 'done')
              progress.append(el('strong', 'Marked ready, merge failed.'))
            progress.append(el('p', describeFailure(result)))
          } catch (e) {
            progress.append(
              el(
                'p',
                'Connection lost. The last reported steps are shown above. Check the pull request on GitHub before retrying. ' +
                  String(e),
              ),
            )
          } finally {
            busy = false
          }
          actions.append(button('Close', () => modal.close()))
        },
        assessment.warnings.some((w) => w.danger) ? 'confirm danger' : 'confirm',
      ),
    )
  }
}
