import { el } from './dom'
let dismiss: (() => void) | undefined
export function popover(anchor: HTMLElement, submenu = false) {
  if (!submenu) dismiss?.()
  const node = el('div', '', 'menu' + (submenu ? ' submenu' : ''))
  document.body.append(node)
  anchor.setAttribute('aria-expanded', 'true')
  const close = (focus = false) => {
    if (!node.isConnected) return
    node.remove()
    anchor.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('resize', onResize)
    if (dismiss === onResize) dismiss = undefined
    node.dispatchEvent(new Event('dismiss'))
    if (focus) anchor.focus()
  }
  const outside = (event: PointerEvent) => {
    const t = event.target
    if (t instanceof Element && !node.contains(t) && !anchor.contains(t) && (submenu || !t.closest('.submenu'))) close()
  }
  const onResize = () => close()
  window.addEventListener('resize', onResize)
  if (!submenu) dismiss = onResize
  document.addEventListener('pointerdown', outside, true)
  node.onkeydown = (e) => {
    const buttons = [...node.querySelectorAll<HTMLElement>('button, [role="menuitemcheckbox"]')].filter(
      (el) => el.getClientRects().length,
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') close(true)
    else if (e.target instanceof HTMLInputElement) {
      if (e.key !== 'ArrowDown') return
      const first = node.querySelector<HTMLElement>('[role="menuitemcheckbox"]')
      if (!first) return
      first.focus()
    } else if (submenu && e.key === 'ArrowLeft') close(true)
    else if (e.target instanceof HTMLSelectElement) return
    else if (['ArrowDown', 'ArrowUp'].includes(e.key))
      buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  const position = (focus = true) => {
    const rect = anchor.getBoundingClientRect()
    const x = submenu
      ? rect.right + node.offsetWidth + 4 <= innerWidth
        ? rect.right + 4
        : rect.left - node.offsetWidth - 4
      : rect.left
    node.style.left = Math.max(4, Math.min(x, innerWidth - node.offsetWidth - 4)) + 'px'
    node.style.top =
      Math.max(4, Math.min(submenu ? rect.top - 5 : rect.bottom + 4, innerHeight - node.offsetHeight - 4)) + 'px'
    if (focus) node.querySelector('button')?.focus()
  }
  return { node, close, position }
}
