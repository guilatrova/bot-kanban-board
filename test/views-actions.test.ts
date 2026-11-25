import { expect, it } from 'vitest'
import fixture from './fixtures/board.json'
import { allView, buildBoard } from '../src/core/board'
import { items, pullRequest } from '../src/core/normalize'
import { stackOrder } from '../src/core/stacks'
import { moveState, moveTimeout, snoozed, snoozeUntil } from '../src/core/actions'

const bot = { ...fixture.bot, computer: 'local', home: null }
const item = items({ items: [fixture.item] }, bot, [])[0]!
const pr = pullRequest(fixture.pr)
it('filters known repositories and preserves unassigned questions', () => {
  const unknown = { ...item, number: 8, text: '' }
  const data = [
    {
      key: 'local',
      name: 'Local',
      source: {
        ok: true as const,
        value: { bots: [bot], items: [item, unknown, { ...unknown, status: 'waiting' as const }], workspaces: [] },
      },
    },
  ]
  const result = buildBoard(data, [pr], { ...allView, repos: ['other/repo'], needsMeOnly: true })
  expect(result.columns.flatMap((c) => c.items)).toEqual([unknown])
  expect(result.ready).toEqual([])
})
it('orders chains within repositories and terminates cycles', () => {
  const b = { ...pr, number: 2, head: 'second', base: pr.head }
  const c = { ...b, number: 3, head: 'third', base: b.head }
  expect(stackOrder([c, b, pr]).map((p) => p.number)).toEqual([1, 2, 3])
  expect(stackOrder([b, { ...pr, base: b.head }])).toHaveLength(2)
  expect(stackOrder([{ ...b, repo: 'other/repo' }, pr])[0]?.behind).toBeUndefined()
})
it('expires local snoozes and gives an active Orca snooze precedence', () => {
  const now = new Date(2026, 2, 7, 11).getTime()
  const end = snoozeUntil('Tomorrow 9:00', now)
  expect(new Date(end).getHours()).toBe(9)
  expect(new Date(snoozeUntil('Monday 9:00', now)).getDay()).toBe(1)
  expect(snoozed(item, end, now)).toBe('board')
  expect(snoozed({ ...item, snoozedUntil: end }, end, now)).toBe('Orca')
  expect(snoozed(item, end, end)).toBeNull()
})
it('reconciles moves only on observed status or expiry', () => {
  const move = { target: 'waiting' as const, at: 100 }
  expect(moveState(move, undefined, 101)).toBe('pending')
  expect(moveState(move, 'waiting', 150)).toBe('confirmed')
  expect(moveState(move, 'needs_you', 100 + moveTimeout)).toBe('expired')
})
