import { allView, selectedBots, type View } from './board'
type Saved = { version: 1; current: View; views: View[] }
export async function storedViews(
  storage: { get(key: string): Promise<unknown> },
  demo: boolean,
  roster: () => Promise<{ name: string; computer: string }[]>,
): Promise<Saved> {
  const state = await storage.get(demo ? 'demo-views' : 'views')
  if (state && typeof state === 'object' && 'version' in state && state.version === 1) return state as Saved
  const old = demo ? null : await storage.get('filter')
  const migrated =
    Array.isArray(old) && old.length
      ? [
          ...selectedBots(
            old.filter((k): k is string => typeof k === 'string'),
            await roster(),
          ),
        ]
      : []
  return {
    version: 1,
    views: [],
    current: {
      ...allView,
      bots: migrated.length ? migrated : 'all',
    },
  }
}
