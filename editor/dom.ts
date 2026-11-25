export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}
export function button(label: string, action: (event: MouseEvent) => unknown, className = '') {
  const b = el('button', label, className)
  b.type = 'button'
  b.onclick = (e) => {
    void Promise.resolve(action(e)).catch(notice)
  }
  return b
}
export function notice(error: unknown) {
  let node = document.querySelector<HTMLElement>('#notice')
  if (!node) {
    node = el('output')
    node.id = 'notice'
    node.setAttribute('role', 'status')
    document.body.append(node)
  }
  node.textContent = String(error).replace(/[\da-f]{8}-[\da-f-]{27,}/gi, '…')
}
export const age = (time: number | string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(time).getTime()) / 60000))
  return minutes < 1
    ? 'just now'
    : minutes < 60
      ? minutes + 'm ago'
      : minutes < 1440
        ? Math.floor(minutes / 60) + 'h ago'
        : Math.floor(minutes / 1440) + 'd ago'
}
export const labels = {
  planned: 'Planned',
  needs_you: 'Needs you',
  in_progress: 'In progress',
  waiting: 'Waiting',
  prs: 'Pull requests',
}
export function prState(pr: { draft: boolean; mergeable: string }) {
  return pr.draft
    ? 'Draft'
    : pr.mergeable === 'CONFLICTING'
      ? 'Conflict'
      : pr.mergeable === 'MERGEABLE'
        ? 'Ready to merge'
        : 'Ready for review'
}
export function external(label: string, url: string) {
  return button(label, async () => {
    if (new URL(url).protocol !== 'https:') throw Error('Invalid GitHub URL')
    const result = await orca.shell?.openExternal(url)
    if (!result?.opened) notice('GitHub did not open. Allow the link in Orca and try again.')
  })
}
const pictures = new Map<string, Promise<string | null>>()
async function loadAvatar(computer: string, bot: string) {
  let offset = 0
  const parts = ['data:image/png;base64,']
  for (;;) {
    const part = await orca.plugin.request('avatar.get', { computer, bot, offset })
    if (!part) return null
    parts.push(part.data)
    if (part.next === null) return parts.join('')
    offset = part.next
  }
}
export function badge(computer: string, bot: string) {
  const span = el(
    'span',
    bot
      .split(/\s+/)
      .map((s) => s[0])
      .join('')
      .slice(0, 2),
    'avatar',
  )
  const hash = Array.from(bot).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0)
  span.style.setProperty('--tint', 'var(--' + ['needs_you', 'in_progress', 'waiting', 'prs'][hash % 4] + ')')
  if (computer === 'local') {
    let picture = pictures.get(bot)
    if (!picture) {
      picture = loadAvatar(computer, bot).catch(() => null)
      pictures.set(bot, picture)
    }
    void picture.then((src) => {
      if (!src) return
      const img = new Image()
      img.alt = ''
      img.onload = () => span.replaceChildren(img)
      img.src = src
    })
  }
  return span
}
