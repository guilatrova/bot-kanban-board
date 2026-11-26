// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { demoBoard } from '../src/demo'
import { allView } from '../src/core/board'
import { parseActions } from '../src/core/actions'
import { readMergeSettings } from '../editor/settings'

afterEach(() => {
  window.dispatchEvent(new Event('resize'))
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.doUnmock('../src/core/flags')
})

it.each([false, true])('renders item actions and drag handles with itemStatusActions=%s', async (enabled) => {
  vi.resetModules()
  vi.doMock('../src/core/flags', () => ({ itemStatusActions: enabled }))
  vi.stubGlobal('orca', { storage: { get: async () => null }, plugin: { on: vi.fn() } })
  const { view } = await import('../editor/render')
  const board = view(
    { version: 1, current: allView, views: [] },
    await readMergeSettings(true),
    { state: parseActions(null), save: async () => {} },
    new Set(),
  )
  const data = demoBoard()
  board.draw(data)
  const card = (lane: string) => document.querySelector<HTMLElement>(`[data-key="${lane}"] article`)!
  expect(card('needs_you').draggable).toBe(enabled)
  expect(card('closed').draggable).toBe(false)
  expect(card('prs').draggable).toBe(true)
  card('needs_you').querySelector<HTMLButtonElement>('.more')!.click()
  const menu = document.querySelector('[role="menu"]')!
  const common = ['Snooze›', 'Open chat in Orca↵']
  expect([...menu.children].map((row) => row.textContent)).toEqual(
    enabled
      ? ['Move to', '✓ Needs youN', 'In progressP', 'WaitingW', '', 'CompleteD', 'Cancel…⌫', '', ...common]
      : common,
  )
  data.sources.orca.status = 'stale'
  board.draw(data)
  expect(card('needs_you').draggable).toBe(false)
})
