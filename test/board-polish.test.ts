import { expect, it } from 'vitest'
import { shownMerges } from '../src/core/merge'

it('caps today’s merges newest first and clamps the preference', () => {
  const now = new Date(2025, 3, 21, 12)
  const rows = Array.from({ length: 55 }, (_, number) => ({
    repo: 'org/app',
    number,
    title: 'Change',
    url: '',
    mergedAt: new Date(2025, 3, 21, 10, number).toISOString(),
  }))
  expect(shownMerges(rows, undefined, now).map((r) => r.number)).toEqual([54, 53, 52, 51, 50, 49, 48, 47, 46, 45])
  for (const [value, count] of [
    [5, 5],
    [0, 1],
    [80, 50],
  ])
    expect(shownMerges(rows, value, now)).toHaveLength(count!)
})
