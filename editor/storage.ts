import type { JsonValue } from 'orca'

const listeners = new Set<(key: string, value: JsonValue) => void>()
export function onStorageWrite(listener: (key: string, value: JsonValue) => void) {
  listeners.add(listener)
}
export async function setStorage(key: string, value: JsonValue) {
  try {
    await orca.storage.set(key, value)
    for (const listener of listeners) listener(key, value)
  } catch (error) {
    const valueBytes = new TextEncoder().encode(JSON.stringify(value)).length
    void Promise.resolve()
      .then(() => orca.plugin.request('storage.failure', { key, valueBytes, error: String(error) }))
      .catch(() => {})
    throw error
  }
}
