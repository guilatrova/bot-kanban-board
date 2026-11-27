export function cached<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
export function persist(key: string, value: unknown) {
  try {
    const text = JSON.stringify(value)
    if (text.length < 4 * 1024 * 1024) localStorage.setItem(key, text)
    else localStorage.removeItem(key)
  } catch {
    /* The open frame keeps the current value in memory. */
  }
}
