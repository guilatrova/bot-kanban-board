export interface CardVisibility {
  key: string
  rendered: boolean
  collapsed: boolean
  inViewport: boolean
}
export function selectableCards(cards: CardVisibility[], drag: boolean) {
  return new Set(
    cards.filter((card) => card.rendered && !card.collapsed && (!drag || card.inViewport)).map((card) => card.key),
  )
}
