export function scrollArea(node: HTMLElement) {
  node.classList.add('scroll-area')
  const sync = () => node.classList.toggle('more-below', node.scrollHeight - node.clientHeight - node.scrollTop > 1)
  node.addEventListener('scroll', sync, { passive: true })
  new ResizeObserver(sync).observe(node)
  new MutationObserver(sync).observe(node, { childList: true, subtree: true, characterData: true })
}
