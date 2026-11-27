import { count } from './metrics'
const pending = new Map<string, Promise<unknown>>()

export function inFlight(key: string) {
  return pending.get(key)
}

export function dedupe<T>(key: string, read: () => Promise<T>): Promise<T> {
  const active = pending.get(key)
  if (active) {
    count('hits')
    return active as Promise<T>
  }
  const job = Promise.resolve()
    .then(read)
    .finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}
