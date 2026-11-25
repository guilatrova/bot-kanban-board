import { itemKey, prKey, type Item, type PullRequest, type Status } from './model'
export type Bell = { kind: 'item'; id: string; baseline: Status } | { kind: 'pr'; id: string }
export function firedBells(bells: Bell[], items: Item[], prs: PullRequest[]) {
  const messages = new Map<string, string>()
  for (const bell of bells) {
    if (bell.kind === 'item') {
      const item = items.find((i) => itemKey(i) === bell.id)
      if (item && item.status !== bell.baseline)
        messages.set(
          bell.id,
          `${item.bot} · #${item.number} moved to ${item.status.replaceAll('_', ' ')}: ${item.title}`,
        )
    } else if (
      prs.some((pr) => prKey(pr) === bell.id && !pr.draft && pr.checks === 'SUCCESS' && pr.mergeable === 'MERGEABLE')
    )
      messages.set(bell.id, bell.id + ' is ready to merge')
  }
  return messages
}
