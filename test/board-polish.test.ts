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

import { selectableCards } from '../src/core/selection'
import { prStats } from '../src/core/presentation'
it('excludes collapsed and filtered cards, keeping scrolled-out checks only outside drag hit tests', () => {
  const open = { key: 'open', rendered: true, collapsed: false, inViewport: true }
  const cards = [
    open,
    { ...open, key: 'hidden', rendered: false },
    { ...open, key: 'folded', collapsed: true },
    { ...open, key: 'outside', inViewport: false },
  ]
  expect([...selectableCards(cards, true)]).toEqual(['open'])
  expect([...selectableCards(cards, false)]).toEqual(['open', 'outside'])
})
it('formats the diff, files and optional check status', () => {
  const pr = { additions: 60594, deletions: 0, files: 202, checks: null }
  expect(prStats(pr)).toEqual({ diff: '+60,594 −0 · 202 files', check: '', failed: false })
  expect(prStats({ ...pr, checks: 'FAILURE' })).toMatchObject({ check: 'Checks failed', failed: true })
})
