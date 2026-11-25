import { statuses, type Item } from './model'

export const targets = [...statuses, 'done', 'canceled'] as const
export type Target = (typeof targets)[number]
export type Move = { target: Target; at: number }
type StoredActions = { version: 1; moves: Record<string, Move>; sleeps: Record<string, number> }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function parseActions(value: unknown): StoredActions {
  const state: StoredActions = { version: 1, moves: {}, sleeps: {} }
  if (!record(value) || (value.version !== undefined && value.version !== 1)) return state
  if (record(value.moves))
    for (const [key, move] of Object.entries(value.moves)) {
      if (!record(move) || typeof move.at !== 'number' || !Number.isFinite(move.at)) continue
      const target = targets.find((t) => t === move.target)
      if (target) state.moves[key] = { target, at: move.at }
    }
  if (record(value.sleeps))
    for (const [key, end] of Object.entries(value.sleeps)) {
      if (typeof end === 'number' && Number.isFinite(end)) state.sleeps[key] = end
    }
  return state
}
export const moveTimeout = 10 * 60_000
export function moveState(move: Move, status: Target | undefined, now: number) {
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
