import { itemKey, type Computer, type Item } from '../../core/model'
import { bots, items, obj, rows, str, workers, workspaces } from '../../core/normalize'
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
  const results = await Promise.all(
    targets.map(async (target) => {
      const env = ['--environment', target.key, '--json']
      const roster = await source('orca bot list', () => read(['bot', 'list', ...env], (v) => bots(v, target.key)))
      if (!roster.ok) {
        const computer = { ...target, source: roster }
        onComputer(computer)
        return computer
      }
      const trees = await source('orca worktree ps', () =>
        read(['worktree', 'ps', '--since', '30d', ...env], (v) => workspaces(v, target.key)),
      )
      const closed: Record<string, 'done' | 'canceled'> = {}
      const byBot = await Promise.all(
        roster.value.map(async (bot) => {
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
          value: { closed, bots: roster.value, workspaces: trees.ok ? trees.value : [], items: byBot.flat() },
        },
      }
      onComputer(computer)
      return computer
    }),
  )
  if (!environments.ok) results.push({ key: 'discovery', name: 'Paired computers', source: environments })
  return results
}
