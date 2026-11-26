import type { Bell } from '../src/core/bells'
import { button } from './dom'
import { icon } from './lanes'

export function bellToggle(bell: Bell, ringing: boolean) {
  const toggle = button(
    '',
    (e) => {
      e.stopPropagation()
      return orca.plugin.request('bell.set', { bell, on: !ringing })
    },
    'bell',
  )
  toggle.append(icon('M4 17h16l-2-3V9a6 6 0 0 0-12 0v5zM10 20a2 2 0 0 0 4 0'))
  toggle.setAttribute('aria-label', 'Notify me')
  toggle.setAttribute('aria-pressed', String(ringing))
  return toggle
}
