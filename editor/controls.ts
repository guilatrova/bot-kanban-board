import { button, el } from './dom'

export function panel(title: string) {
  const dialog = el('dialog', '', 'merge-dialog controls')
  dialog.setAttribute('aria-label', title)
  dialog.append(
    el('h2', title),
    button('Close', () => dialog.close()),
  )
  document.body.append(dialog)
  dialog.onclose = () => dialog.remove()
  dialog.showModal()
  return dialog
}

export function ask(title: string, value: string, submit: (text: string) => void) {
  const dialog = panel(title),
    form = el('form'),
    input = el('input')
  input.setAttribute('aria-label', title)
  input.value = value
  input.required = true
  input.maxLength = 300
  const accept = el('button', 'Continue')
  form.append(input, accept)
  form.onsubmit = (e) => {
    e.preventDefault()
    if (!input.value.trim()) return
    submit(input.value.trim())
    dialog.close()
  }
  dialog.append(form)
  input.select()
}
