import { prKey, type MappedPr } from '../src/core/model'
import { button, el } from './dom'
import { icon } from './lanes'

export function selection(lane: HTMLElement, cards: Map<string, HTMLElement>, merge: (prs: MappedPr[]) => void) {
  const selected = new Set<string>()
  let visible = new Map<string, MappedPr>()
  const label = el('span', '', 'c')
  const clear = () => {
    selected.clear()
    sync()
  }
  const go = button('Merge all', () => merge([...selected].map((k) => visible.get(k)!)), 'go')
  const bar = el('div', '', 'selbar')
  bar.append(label, button('Clear', clear), go)
  lane.append(bar)
  function sync() {
    label.textContent = selected.size + ' selected'
    lane.classList.toggle('sel-mode', !!selected.size)
    bar.inert = !selected.size
    bar.classList.toggle('on', !!selected.size)
    for (const k of visible.keys()) {
      const node = cards.get(k)
      node?.classList.toggle('sel', selected.has(k))
      node?.querySelector('.check')?.setAttribute('aria-pressed', String(selected.has(k)))
    }
  }
  function toggle(k: string) {
    if (selected.has(k)) selected.delete(k)
    else selected.add(k)
    sync()
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clear()
  })
  return {
    clear,
    go,
    draw(prs: MappedPr[]) {
      visible = new Map(prs.map((p) => [prKey(p), p]))
      for (const k of selected) if (!visible.has(k)) selected.delete(k)
      sync()
    },
    click(e: MouseEvent, k: string) {
      if (!e.metaKey && !e.ctrlKey && !selected.size) return false
      toggle(k)
      return true
    },
    checkbox(k: string) {
      const b = button(
        '',
        (e) => {
          e.stopPropagation()
          toggle(k)
        },
        'check',
      )
      b.setAttribute('aria-label', 'Select ' + k)
      b.append(icon('M4 12l5 5L20 6'))
      return b
    },
    batch(pr: MappedPr) {
      return selected.has(prKey(pr))
        ? [pr, ...[...selected].filter((k) => k !== prKey(pr)).map((k) => visible.get(k)!)]
        : [pr]
    },
  }
}

export function buildDeck(prs: MappedPr[], cards: Map<string, HTMLElement>, event: DragEvent) {
  const deck = el('div', '', 'deck')
  document.body.append(deck)
  const move = (x: number, y: number) => (deck.style.transform = 'translate(' + (x - 20) + 'px,' + (y - 16) + 'px)')
  move(event.clientX, event.clientY)
  const pixel = document.createElement('canvas')
  pixel.width = pixel.height = 1
  event.dataTransfer?.setDragImage(pixel, 0, 0)
  for (const [i, pr] of prs.entries()) {
    const card = cards.get(prKey(pr))
    if (!card) continue
    const rect = card.getBoundingClientRect()
    card.classList.add('lift')
    if (i > 3) continue
    const layer = el('div', '', 'dc')
    layer.append(el('small', prKey(pr)), el('div', pr.title, 't'))
    layer.style.zIndex = String(4 - i)
    layer.style.transform =
      'translate(' + (rect.left - event.clientX + 20) + 'px,' + (rect.top - event.clientY + 16) + 'px)'
    deck.append(layer)
    void layer.offsetWidth
    layer.style.transform =
      'translate(' +
      i * 5 +
      'px,' +
      i * 5 +
      'px) rotate(' +
      (i ? (i % 2 ? 2.5 : -2) : 0) +
      'deg) scale(' +
      (1 - i * 0.03) +
      ')'
  }
  if (prs.length > 1) deck.append(el('span', String(prs.length), 'badge'))
  requestAnimationFrame(() => deck.classList.add('ready'))
  const follow = (e: DragEvent) => move(e.clientX, e.clientY)
  document.addEventListener('dragover', follow)
  return (queue?: HTMLElement) => {
    document.removeEventListener('dragover', follow)
    for (const pr of prs) cards.get(prKey(pr))?.classList.remove('lift')
    if (!queue || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      deck.remove()
      return
    }
    const r = queue.getBoundingClientRect()
    Object.assign(deck.style, {
      transition: 'transform .35s cubic-bezier(.5,0,.2,1), opacity .35s',
      transform: 'translate(' + (r.left + 10) + 'px,' + (r.top + 10) + 'px) scale(.6)',
      opacity: '0',
    })
    setTimeout(() => deck.remove(), 350)
  }
}
