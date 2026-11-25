export function cardMotion(cards: Map<string, HTMLElement>) {
  const positions = new Map(
    [...cards].map(([key, node]) => [
      key,
      { lane: node.closest('.lane')?.getAttribute('data-key'), rect: node.getBoundingClientRect(), node },
    ]),
  )
  return (alive: Set<string>) => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const [key, old] of positions) {
        if (
          old.lane &&
          old.rect.width &&
          (!alive.has(key) || old.lane !== cards.get(key)?.closest('.lane')?.getAttribute('data-key'))
        ) {
          const ghost = old.node.cloneNode(true) as HTMLElement
          ghost.inert = true
          ghost.classList.remove('fresh')
          ghost.classList.add('leaving')
          Object.assign(ghost.style, {
            top: old.rect.top + 'px',
            left: old.rect.left + 'px',
            width: old.rect.width + 'px',
            height: old.rect.height + 'px',
          })
          document.body.append(ghost)
          setTimeout(() => ghost.remove(), 200)
        }
      }
      for (const [key, node] of cards)
        if (positions.get(key)?.lane !== node.closest('.lane')?.getAttribute('data-key')) {
          node.classList.remove('fresh')
          void node.offsetWidth
          node.classList.add('fresh')
        }
    }
  }
}
