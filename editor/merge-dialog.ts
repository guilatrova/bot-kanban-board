import {
  checksLabel,
  mergeableLabel,
  type Warning,
  methodLabels,
  type MergePreferences,
  assessMerge,
  type RepositoryFacts,
  type MergeMethod,
} from '../src/core/merge'
import { prKey, type MappedPr, type Source } from '../src/core/model'
import { el, button, describeFailure, notice } from './dom'

export function mergeDialog(
  saved: MergePreferences,
  update: () => void,
  start: (pr: MappedPr, method: MergeMethod, warnings: Warning[]) => void,
) {
  const modal = el('dialog', '', 'merge-dialog')
  modal.setAttribute('aria-label', 'Confirm pull request merge')
  document.body.append(modal)
  let active = '',
    busy = false

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
  return (pr: MappedPr, facts?: Source<RepositoryFacts>, closing = false) => {
    if (modal.open) return
    active = prKey(pr)

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
      el(
        'p',
        [mergeableLabel(pr.mergeable), checksLabel(pr.checks), '+' + pr.additions + ' −' + pr.deletions].join(' · '),
      ),
    )
    for (const w of assessment.warnings) summary.append(el('p', w.text, w.danger ? 'warning danger' : 'warning'))
    for (const blocker of assessment.blockers) summary.append(el('p', blocker, 'warning'))
    if (!assessment.canMerge) return
    const select = el('select'),
      label = el('label', 'Merge method ')
    for (const m of assessment.methods) {
      const opt = el('option', methodLabels[m])
      opt.selected = m === saved.mergeMethod
      opt.value = m
      select.append(opt)
    }
    label.append(select)
    summary.append(label)
    if (!assessment.methods.includes(saved.mergeMethod))
      summary.append(
        el(
          'p',
          'This repository does not allow ' + methodLabels[saved.mergeMethod] + '. Choose another method.',
          'warning',
        ),
      )
    const skip = el('label', '', 'skip'),
      checkbox = el('input')
    checkbox.type = 'checkbox'
    skip.append(checkbox, "Don't ask again for clean pull requests")
    summary.append(skip)
    actions.append(
      button(
        'Confirm merge',
        () => {
          modal.close()
          if (checkbox.checked) {
            saved.askBeforeMerging = false
            update()
          }
          start(pr, select.value as MergeMethod, assessment.warnings)
        },
        assessment.warnings.some((w) => w.danger) ? 'confirm danger' : 'confirm',
      ),
    )
  }
}
