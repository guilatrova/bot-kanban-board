const pending = new Map<string, Promise<unknown>>()

export function dedupe<T>(key: string, read: () => Promise<T>): Promise<T> {
  const active = pending.get(key)
  if (active) return active as Promise<T>
  const job = Promise.resolve()
    .then(read)
    .finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}
