export function checksLabel(checks: string | null) {
  if (!checks) return 'No checks'
  if (checks === 'SUCCESS') return 'Checks passed'
  return ['FAILURE', 'ERROR'].includes(checks) ? 'Checks failed' : 'Checks running'
}
export function mergeableLabel(state: string) {
  if (state === 'MERGEABLE') return 'No conflicts'
  return state === 'CONFLICTING' ? 'Conflicts' : 'Checking for conflicts'
}
export const countLabel = (count: number, noun: string) => count + ' ' + noun + (count === 1 ? '' : 's')
