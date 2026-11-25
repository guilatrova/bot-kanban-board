import { el } from './dom'

export function skeleton(compact: boolean) {
  const node = el('div', '', 'loading-board')
  node.setAttribute('aria-busy', 'true')
  const header = el('header'),
    board = el('main')
  function bar(width: string, height: number, round = false) {
    const b = el('span', '', 'sk')
    Object.assign(b.style, { width, height: height + 'px', borderRadius: round ? '999px' : '' })
    return b
  }
  header.append(bar('138px', 16))
  for (let i = 0; i < 6; i++) header.append(bar('92px', 28, true))
  for (const [index, cards] of [3, 4, 6, 8, 8].entries()) {
    const lane = el('section', '', 'lane'),
      title = el('h2'),
      list = el('div', '', 'list')
    title.append(bar('90px', 12))
    lane.append(title, list)
    board.append(lane)
    for (let j = 0; j < cards; j++) {
      const merged = index === 4
      const card = el('div', '', merged ? 'sk-merged' : compact ? 'sk-card sk-compact' : 'sk-card')
      if (merged) card.append(bar('55%', 9), bar(85 - ((j * 7) % 30) + '%', 11))
      else if (compact) card.append(bar('16px', 16, true), bar(62 - ((j * 9) % 35) + '%', 10), bar('34px', 10))
      else {
        const meta = el('div', '', 'sk-meta')
        meta.append(bar('20px', 20, true), bar('66px', 10))
        card.append(meta, bar(90 - ((j * 7) % 25) + '%', 12), bar(62 - ((j * 9) % 35) + '%', 12))
      }
      list.append(card)
    }
  }
  node.append(header, board)
  return node
}
