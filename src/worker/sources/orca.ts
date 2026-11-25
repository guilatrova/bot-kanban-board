import { itemKey, type Computer, type Item } from '../../core/model'
import { botOwners, bots, items, obj, rows, str, workers, workspaces } from '../../core/normalize'
import { reader, source } from './read'
export async function computers(
  path: string,
  closing: Set<string>,
  onComputer: (computer: Computer) => void,
): Promise<Computer[]> {
  const read = reader('orca', path)
  const environments = await source('orca environment list', () =>
    read(['environment', 'list', '--json'], (v) =>
      rows(obj(v).environments)
        .map(obj)
        .map((e) => ({ key: str(e, 'id'), name: str(e, 'name') })),
    ),
  )
  const targets = [{ key: 'local', name: 'This computer' }, ...(environments.ok ? environments.value : [])]
  const rosters = await Promise.all(
    targets.map(async (target) => {
      const env = ['--environment', target.key, '--json']
      const roster = await source('orca bot list', () => read(['bot', 'list', ...env], (v) => bots(v, target.key)))
      return { target, env, roster }
    }),
  )
  const owners = botOwners(
    rosters.flatMap(({ target, roster }) => (roster.ok ? [{ key: target.key, bots: roster.value }] : [])),
  )
  const results = await Promise.all(
    rosters.map(async ({ target, env, roster }) => {
      if (!roster.ok) {
        const computer = { ...target, source: roster }
        onComputer(computer)
        return computer
      }
      const resident = roster.value.filter((b) => owners.get(b.id) === target.key)
      if (!resident.length) {
        const computer: Computer = { ...target, source: { ok: true, value: { bots: [], workspaces: [], items: [] } } }
        onComputer(computer)
        return computer
      }
      const trees = await source('orca worktree ps', () =>
        read(['worktree', 'ps', '--since', '30d', ...env], (v) => workspaces(v, target.key)),
      )
      const closed: Record<string, 'done' | 'canceled'> = {}
      const byBot = await Promise.all(
        resident.map(async (bot) => {
          const result = await source('orca bot item list', async () => {
            const args = ['--bot', bot.name, ...env],
              live = await read(['bot', 'work', 'list', ...args], workers),
              all: Item[] = []
            let cursor: string | null = null
            const includeClosed = [...closing].some((k) =>
              k.startsWith(JSON.stringify([target.key, bot.name]).slice(0, -1) + ','),
            )
            const seen = new Set<string>()
            do {
              const page: { items: Item[]; next: unknown } = await read(
                [
                  'bot',
                  'item',
                  'list',
                  ...(includeClosed ? ['--all'] : []),
                  ...args,
                  ...(cursor ? ['--cursor', cursor] : []),
                ],
                (v) => {
                  if (includeClosed)
                    for (const row of rows(obj(v).items).map(obj)) {
                      if (typeof row.number !== 'number' || (row.status !== 'done' && row.status !== 'canceled'))
                        continue
                      const key = itemKey({ computer: target.key, bot: bot.name, number: row.number })
                      if (closing.has(key)) closed[key] = row.status
                    }
                  return { items: items(v, bot, live), next: obj(v).nextCursor }
                },
              )
              all.push(...page.items)
              cursor = typeof page.next === 'string' ? page.next : null
              if (cursor && seen.has(cursor)) throw Error('Item pagination repeated a cursor')
              if (cursor) seen.add(cursor)
            } while (cursor)
            return all
          })
          if (!result.ok) bot.warning = result
          return result.ok ? result.value : []
        }),
      )
      const computer: Computer = {
        ...target,
        warning: trees.ok ? undefined : trees,
        source: {
          ok: true,
          value: {
            closed,
            bots: resident,
            workspaces: trees.ok ? trees.value.filter((w) => resident.some((b) => b.name === w.bot)) : [],
            items: byBot.flat(),
          },
        },
      }
      onComputer(computer)
      return computer
    }),
  )
  if (!environments.ok)
    results.push({
      key: 'discovery',
      name: 'Paired computers',
      warning: environments,
      source: { ok: true, value: { bots: [], items: [], workspaces: [] } },
    })
  return results
}
