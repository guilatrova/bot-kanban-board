import { describe, it, expect } from 'vitest'
import sample from './fixtures/board.json'
import { botOwners, bots, unpairedComputers, items, pullRequest } from '../src/core/normalize'
import { mapPrs } from '../src/core/map-prs'
import { allView, buildBoard, toggleBot } from '../src/core/board'
import { botKey, type Bot, type Computer, type Workspace } from '../src/core/model'
const bot: Bot = { ...sample.bot, computer: 'local', home: null }
const item = items({ items: [sample.item] }, bot, [])[0]!
const pr = pullRequest(sample.pr)
const workspace: Workspace = {
  computer: 'local',
  id: 'sample-workspace',
  bot: bot.name,
  name: 'Marker',
  repo: 'sample',
  branch: 'marker',
  home: null,
}
describe('normalize', () => {
  it('requires source fields', () => {
    expect(() => bots({ bots: [{}] }, 'local')).toThrow('id')
    expect(() => pullRequest({ ...sample.pr, changedFiles: null })).toThrow('changedFiles')
  })
  it('queries a federated bot only on the runtime that lists it as resident', () => {
    const clio = { id: 'clio-id', name: 'Clio' }
    const mac = bots({ bots: [{ ...clio, server: { name: 'Dell', id: 'dell' } }] }, 'local')
    const dell = bots({ bots: [clio] }, 'dell')
    expect(
      botOwners([
        { key: 'local', bots: bots({ bots: [clio] }, 'local') },
        { key: 'dell', bots: dell },
      ]).get(clio.id),
    ).toBe('dell')
    expect(mac[0]?.computer).toBe('federated:dell')
    expect(unpairedComputers(mac, [{ key: 'dell', name: 'Dell' }], new Map())).toEqual([])
    expect(dell.map((b) => b.computer)).toEqual(['dell'])
    const board = buildBoard(
      [
        {
          key: 'local',
          name: 'Mac',
          source: { ok: true, value: { bots: mac.filter((b) => b.computer === 'local'), items: [], workspaces: [] } },
        },
      ],
      [],
      allView,
    )
    expect(board.computers).toEqual([])
  })
  it('shows a federated bot once under its unpaired server with a named warning', () => {
    const bot = { id: 'clio', name: 'Clio', server: { name: 'Field station', on: 'field-id' } }
    const roster = bots({ bots: [bot, bot] }, 'local')
    const computers = unpairedComputers(roster, [], botOwners([{ key: 'local', bots: roster }]))
    const board = buildBoard(computers, [], allView)
    expect(board.bots.map((b) => [b.name, b.computer])).toEqual([['Clio', 'federated:field-id']])
    expect(board.computers[0]?.warning?.message).toContain('Field station')
  })
  it('preserves optional data and excludes closed rows', () => {
    expect(item.chat).toBeNull()
    expect(item.options).toEqual(['First'])
    expect(items({ items: [{ status: 'done' }] }, bot, [])).toEqual([])
  })
})
describe('mapping', () => {
  it('prefers direct references and keeps all matching Items', () => {
    const result = mapPrs([pr], [item, { ...item, number: 8 }, { ...item, text: 'sample#42' }], [workspace])[0]
    expect(result?.how).toBe('item')
    expect(result?.items.map((i) => i.number)).toEqual([7, 8])
    expect(result?.workspaces).toEqual([workspace])
  })
  it('respects number and owner boundaries and matches closing issues', () => {
    expect(
      mapPrs([pr], [{ ...item, text: 'sample#12 other/sample#1' }], [{ ...workspace, repo: 'other/sample' }])[0]?.how,
    ).toBeNull()
    expect(mapPrs([pr], [{ ...item, text: 'orchard/sample#42' }], [])[0]?.how).toBe('issue')
    expect(mapPrs([pr], [], [workspace])[0]?.how).toBe('branch')
  })
})
it('orders columns, counts bots across computers and applies filters', () => {
  const computers: Computer[] = ['local', 'remote'].map((key) => ({
    key,
    name: key,
    source: {
      ok: true,
      value: {
        bots: [{ ...bot, computer: key }],
        items: [
          { ...item, computer: key },
          { ...item, number: 9, updated: 1, computer: key },
        ],
        workspaces: [],
      },
    },
  }))
  const board = buildBoard(computers, [pr], { ...allView, bots: [botKey('remote', bot.name)] })
  expect(board.columns.map((c) => c.status)).toEqual(['needs_you', 'in_progress', 'waiting'])
  expect(board.columns[0]?.items.map((i) => i.number)).toEqual([9, 7])
  expect(board.bots.map((b) => b.count)).toEqual([2, 2])
  expect(board.ready).toHaveLength(1)
})

it('solos, toggles, and restores all bots when the last is disabled', () => {
  const all = ['one', 'two']
  expect([...toggleBot(new Set(), all, 'one', false)]).toEqual(['two'])
  expect([...toggleBot(new Set(['one']), all, 'two', true)]).toEqual(['two'])
  expect([...toggleBot(new Set(['two']), all, 'two', false)]).toEqual([])
})
it('puts Planned first and Waiting in newest-change order', () => {
  const board = buildBoard(
    [
      {
        key: 'local',
        name: 'Local',
        source: {
          ok: true,
          value: {
            bots: [bot],
            workspaces: [],
            items: [
              { ...item, status: 'planned' },
              { ...item, status: 'waiting' },
              { ...item, status: 'waiting', number: 12, updated: 900 },
            ],
          },
        },
      },
    ],
    [],
    { ...allView, bots: [] },
  )
  expect(board.columns.map((c) => c.status)).toEqual(['planned', 'needs_you', 'in_progress', 'waiting'])
  expect(board.columns.at(-1)?.items.map((i) => i.number)).toEqual([12, 7])
})
it('reads decision replies and excludes structured PR link metadata from mapping', () => {
  const [i] = items(
    {
      items: [
        {
          ...sample.item,
          description: 'Field notes',
          question: { text: 'Which?', decisions: [{ replies: [{ label: 'North' }] }] },
          links: [{ kind: 'dispatch', title: 'Observe', pr: { title: 'orchard/sample#1' } }],
        },
      ],
    },
    bot,
    [],
  )
  expect(i?.options).toEqual(['North'])
  expect(i?.text).not.toContain('sample#1')
})
