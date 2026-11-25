import type { Computer, Item } from '../../core/model'
import { bots, items, obj, rows, str, workers, workspaces } from '../../core/normalize'
import { reader, source } from './read'
export async function computers(path: string): Promise<Computer[]> {
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
      const result = await source('orca bot list', async () => {
        const [roster, trees] = await Promise.all([
          read(['bot', 'list', ...env], (v) => bots(v, target.key)),
          read(['worktree', 'ps', '--since', '30d', ...env], (v) => workspaces(v, target.key)),
        ])
        const byBot = await Promise.all(
          roster.map(async (bot) => {
            const args = ['--bot', bot.name, ...env],
              live = await read(['bot', 'work', 'list', ...args], workers),
              all: Item[] = []
            let cursor: string | null = null
            const seen = new Set<string>()
            do {
              const page: { items: Item[]; next: unknown } = await read(
                ['bot', 'item', 'list', ...args, ...(cursor ? ['--cursor', cursor] : [])],
                (v) => ({ items: items(v, bot, live), next: obj(v).nextCursor }),
              )
              all.push(...page.items)
              cursor = typeof page.next === 'string' ? page.next : null
              if (cursor && seen.has(cursor)) throw Error('Item pagination repeated a cursor')
              if (cursor) seen.add(cursor)
            } while (cursor)
            return all
          }),
        )
        return { bots: roster, workspaces: trees, items: byBot.flat() }
      })
      return { ...target, source: result }
    }),
  )
  if (!environments.ok) results.push({ key: 'discovery', name: 'Paired computers', source: environments })
  return results
}
