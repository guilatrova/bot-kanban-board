import { panelRequest } from './panel-request'
import {
  checksLabel,
  mergeableLabel,
  type Warning,
  methodLabels,
  type MergePreferences,
  assessMerge,
  type MergeMethod,
} from '../src/core/merge'
import { prKey, type MappedPr } from '../src/core/model'
import { el, button, describeFailure, notice } from './dom'

export function mergeDialog(saved: MergePreferences, update: () => void) {
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
  return async (
    pr: MappedPr,
    closing = false,
    chosen?: (method: MergeMethod, warnings: Warning[], live: MappedPr) => void,
    dismiss?: () => void,
  ) => {
    if (modal.open) {
      dismiss?.()
      return
    }
    modal.onclose = () => dismiss?.()
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
              const result = await panelRequest('pr.close', { repo: pr.repo, number: pr.number })
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
    summary.textContent = 'Reading pull request…'
    const read = await panelRequest(
      'pr.read',
      { repo: pr.repo, number: pr.number, prOnly: true },
      { timeoutMs: 120000 },
    ).catch((error: unknown) => {
      summary.textContent = String(error)
      return null
    })
    if (!read || !modal.open || !modal.contains(summary)) return
    if (!read.ok) {
      summary.textContent = describeFailure(read)
      return
    }
    const live = read.value
    if (live.closed || live.merged) {
      summary.textContent = live.merged ? 'Pull request already merged.' : 'Pull request already closed.'
      return
    }
    pr = { ...pr, ...live.pr, sha: live.pr.sha, behind: live.pr.behind }
    const facts = live.facts
    summary.replaceChildren()
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
        [mergeableLabel(pr.mergeable), checksLabel(pr.checks), '+' + pr.additions + ' −' + pr.deletions]
          .filter(Boolean)
          .join(' · '),
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
          modal.onclose = null
          modal.close()
          if (checkbox.checked) {
            saved.askBeforeMerging = false
            update()
          }
          chosen?.(select.value as MergeMethod, assessment.warnings, pr)
        },
        assessment.warnings.some((w) => w.danger) ? 'confirm danger' : 'confirm',
      ),
    )
  }
}
