import { itemKey, prKey, type IssueRef, type Item, type PullRequest, type Status } from './model'
export type Bell = { kind: 'item'; id: string; baseline: Status } | { kind: 'pr'; id: string }
export type BellRead = { items: Item[] } | { open: PullRequest[]; merged: IssueRef[]; complete: boolean }
export function resolvedBells(bells: Bell[], read: BellRead) {
  const messages = new Map<string, string | null>()
  for (const bell of bells) {
    if (bell.kind === 'item' && 'items' in read) {
      const item = read.items.find((i) => itemKey(i) === bell.id)
      if (item && item.status !== bell.baseline)
        messages.set(
          bell.id,
          `${item.bot} · #${item.number} moved to ${item.status.replaceAll('_', ' ')}: ${item.title}`,
        )
    } else if (bell.kind === 'pr' && 'open' in read) {
      const open = read.open.find((pr) => prKey(pr) === bell.id)
      if (read.merged.some((pr) => prKey(pr) === bell.id)) messages.set(bell.id, bell.id + ' was merged')
      else if (open && !open.draft && open.checks === 'SUCCESS' && open.mergeable === 'MERGEABLE')
        messages.set(bell.id, bell.id + ' is ready to merge')
      else if (!open && read.complete) messages.set(bell.id, null)
    }
  }
  return messages
}
