import { type MergedPr } from '../src/core/merge'
import { prKey } from '../src/core/model'
import { el, age, openExternal, notice } from './dom'
import { icon } from './lanes'

export function mergedRow(pr: MergedPr) {
  const node = el('div', '', 'merged-card'),
    meta = el('small'),
    url = 'https://github.com/' + pr.repo + '/pull/' + pr.number
  const link = el('a', prKey(pr))
  link.href = url
  link.onclick = (e) => {
    e.preventDefault()
    void openExternal(url).catch(notice)
  }
  link.className = 'gh'
  link.append(icon('M6 18 18 6M7 6h11v11'))
  meta.append(link, ' · ', el('time', age(pr.mergedAt)))
  node.append(meta, el('h3', pr.title), el('span', '✓', 'ck'))
  return node
}
export async function land(list: HTMLElement, card: HTMLElement | undefined, row: HTMLElement, commit: () => void) {
  list.scrollTop = 0
  if (!card || !list.offsetWidth || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commit()
    return
  }
  const css = getComputedStyle(list),
    width = list.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
  const probe = row.cloneNode(true) as HTMLElement
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', width: width + 'px' })
  list.append(probe)
  const height = probe.offsetHeight
  probe.remove()
  const slot = el('div', '', 'slot')
  list.prepend(slot)
  const from = card.getBoundingClientRect(),
    to = slot.getBoundingClientRect()
  const copy = el('div', '', 'morph')
  copy.append(el('div', row.querySelector('h3')!.textContent ?? '', 't'))
  Object.assign(copy.style, {
    top: from.top + 'px',
    left: from.left + 'px',
    width: from.width + 'px',
    height: from.height + 'px',
  })
  document.body.append(copy)
  card.style.height = from.height + 'px'
  card.classList.add('gone')
  void copy.offsetWidth
  Object.assign(card.style, { height: '0px', paddingBlock: '0px', marginBlock: '0px', borderWidth: '0px' })
  slot.style.height = height + 'px'
  Object.assign(copy.style, {
    top: to.top + 'px',
    left: to.left + 'px',
    width: width + 'px',
    height: height + 'px',
    background: 'var(--morph-bg)',
    borderColor: 'var(--run)',
  })
  await new Promise((resolve) => setTimeout(resolve, 550))
  copy.remove()
  slot.replaceWith(row)
  card.remove()
  row.classList.add('arrive')
  commit()
}
