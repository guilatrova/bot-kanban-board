import { describe, it, expect } from 'vitest'
import { assessMerge, mustConfirmMerge, mergedToday, type RepositoryFacts } from '../src/core/merge'
import { pullRequest } from '../src/core/normalize'
import fixture from './fixtures/board.json'
const pr = {
  ...pullRequest(fixture.pr),
  title: 'Update map',
  draft: false,
  base: 'main',
  checks: 'SUCCESS',
  mergeable: 'MERGEABLE',
}
const repo: RepositoryFacts = {
  defaultBranch: 'main',
  push: true,
  methods: ['merge', 'squash'],
}
describe('merge assessment', () => {
  it('offers allowed methods and prefers squash', () => {
    expect(assessMerge(pr, repo)).toMatchObject({
      warnings: [],
      blockers: [],
      canMerge: true,
      methods: ['squash', 'merge'],
      defaultMethod: 'squash',
    })
    expect(assessMerge(pr, { ...repo, methods: ['rebase'] }).defaultMethod).toBe('rebase')
  })
  it('blocks conflicts, missing permission and unavailable methods', () => {
    for (const [p, r] of [
      [{ ...pr, mergeable: 'CONFLICTING' }, repo],
      [pr, { ...repo, push: false }],
      [pr, { ...repo, methods: [] }],
    ] as const)
      expect(assessMerge(p, { ...r, methods: [...r.methods] })).toMatchObject({
        canMerge: false,
        blockers: [expect.any(String)],
      })
  })
  it('warns about drafts, base, absent checks and large changes', () => {
    const result = assessMerge(
      { ...pr, draft: true, base: 'preview', checks: null, additions: 4999, deletions: 1 },
      repo,
    )
    expect(result.warnings.map((w) => w.text)).toEqual([
      expect.stringMatching(/ready/),
      expect.stringMatching(/preview/),
      expect.stringMatching(/No checks/),
      expect.stringMatching(/large/),
    ])
    for (const checks of ['PENDING', 'FAILURE'])
      expect(assessMerge({ ...pr, checks }, repo).warnings[0]?.text).toContain(
        checks === 'PENDING' ? 'Checks running' : 'Checks failed',
      )
  })
  it.each(['do not merge', 'don\x27t merge', 'dont merge', 'not merge', 'WIP', 'Test Only', '[NO MERGE]'])(
    'flags %s',
    (title) => {
      expect(assessMerge({ ...pr, title }, repo).warnings).toContainEqual(expect.objectContaining({ danger: true }))
    },
  )
  it('selects the local calendar day and sorts by merge time', () => {
    const dates = [new Date(2025, 4, 2), new Date(2025, 4, 1, 23, 59), new Date(2025, 4, 2, 23), new Date(2025, 4, 3)]
    const entries = dates.map((d, number) => ({ ...pr, number, mergedAt: d.toISOString() }))
    expect(mergedToday(entries, dates[0]).map((p) => p.number)).toEqual([2, 0])
  })
})

describe('merge confirmation', () => {
  const clean = { ...pr, sha: 'head' }
  const warned = { ...clean, checks: null, additions: 6000 }
  it('skips warnings when confirmation is off', () => {
    expect(mustConfirmMerge(warned, repo, 'merge', undefined, false)).toBe(false)
  })
  it('requires confirmation for conflicts even when confirmation is off', () => {
    expect(mustConfirmMerge({ ...clean, mergeable: 'CONFLICTING' }, repo, 'merge', undefined, false)).toBe(true)
  })
  it('asks by default and reuses approval unless new warnings appear', () => {
    const confirmed = { mergeable: clean.mergeable, warnings: [] }
    expect(mustConfirmMerge(clean, repo, 'merge', undefined, true)).toBe(true)
    expect(mustConfirmMerge(clean, repo, 'merge', confirmed, true)).toBe(false)
    expect(mustConfirmMerge(warned, repo, 'merge', confirmed, true)).toBe(true)
  })
})
