export const maxBackoff = 360000

export function backoffDelay(consecutive: number, initial = 90000, cap = maxBackoff) {
  return Math.min(cap, initial * 2 ** (consecutive - 1))
}

export function retryLabel(delay: number) {
  return delay === 90000 ? 'in 90 seconds' : 'in ' + delay / 60000 + ' min'
}
