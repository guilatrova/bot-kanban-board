import type { Item, Status } from './model'

export type Target = Status | 'done' | 'canceled'
export type Move = { target: Target; at: number }
export const moveTimeout = 10 * 60_000
export function moveState(move: Move, status: Item['status'] | undefined, now: number) {
  if (move.target === status) return 'confirmed'
  return now >= move.at + moveTimeout ? 'expired' : 'pending'
}
export const snoozeChoices = ['1 hour', 'Tomorrow 9:00', 'Monday 9:00'] as const
export function snoozeUntil(choice: (typeof snoozeChoices)[number], now: number) {
  if (choice === '1 hour') return now + 3600_000
  const day = new Date(now)
  day.setHours(9, 0, 0, 0)
  const offset = choice === 'Tomorrow 9:00' ? 1 : (8 - day.getDay()) % 7
  day.setDate(day.getDate() + (offset || (day.getTime() <= now ? 7 : 0)))
  return day.getTime()
}
export function snoozed(item: Item, local: number | undefined, now: number) {
  if (item.snoozedUntil && item.snoozedUntil > now) return 'Orca'
  return local && local > now ? 'board' : null
}
