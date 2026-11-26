import type { JsonValue } from 'orca'

export async function setStorage(key: string, value: JsonValue) {
  try {
    await orca.storage.set(key, value)
  } catch (error) {
    const valueBytes = new TextEncoder().encode(JSON.stringify(value)).length
    void Promise.resolve()
      .then(() => orca.plugin.request('storage.failure', { key, valueBytes, error: String(error) }))
      .catch(() => {})
    throw error
  }
}
