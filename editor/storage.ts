import type { JsonValue } from 'orca'

let storageReads = 0,
  storageWrites = 0,
  bytes = 0
export async function getStorage(key: string) {
  storageReads++
  const value = await orca.storage.get(key)
  bytes += new TextEncoder().encode(JSON.stringify({ value })).length
  return value
}
export function trafficReport() {
  if (!storageReads && !storageWrites) return {}
  const frameTraffic = { storageReads, storageWrites, bytes }
  storageReads = storageWrites = bytes = 0
  return { frameTraffic }
}
const listeners = new Set<(key: string, value: JsonValue) => void>()
export function onStorageWrite(listener: (key: string, value: JsonValue) => void) {
  listeners.add(listener)
}
export async function setStorage(key: string, value: JsonValue) {
  try {
    storageWrites++
    await orca.storage.set(key, value)
    bytes += JSON.stringify({ ok: true }).length
    for (const listener of listeners) listener(key, value)
  } catch (error) {
    const valueBytes = new TextEncoder().encode(JSON.stringify(value)).length
    void Promise.resolve()
      .then(() => orca.plugin.request('storage.failure', { key, valueBytes, error: String(error) }))
      .catch(() => {})
    throw error
  }
}
