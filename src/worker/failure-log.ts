import type { OrcaWorkerApi } from 'orca/worker'
import type { StorageApi } from 'orca'
import { storageGroup } from './chunked-storage'
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { localDate } from '../core/merge'
import { pluginDataFolder } from './board-file'

type Entry = { step: string; repo?: string; number?: number; error: unknown }

function errorText(error: unknown) {
  if (error instanceof Error) return error.stack || error.message
  return typeof error === 'string' ? error : inspect(error, { depth: null, maxStringLength: null, compact: true })
}

export function failureLog(dir = pluginDataFolder(), fallback: (message: string) => void = console.warn) {
  const logs = join(dir, 'logs')
  let lastDay = ''
  async function prune(now: Date) {
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - 7)
    const oldest = localDate(cutoff)
    await mkdir(logs, { recursive: true })
    for (const entry of await readdir(logs, { withFileTypes: true })) {
      if (entry.isFile() && /^\d{4}-\d{2}-\d{2}\.log$/.test(entry.name) && entry.name.slice(0, 10) < oldest)
        await unlink(join(logs, entry.name))
    }
  }
  function report(cause: unknown, entry?: Entry) {
    try {
      fallback(String(cause) + (entry ? ' · ' + entry.step + ' · ' + errorText(entry.error) : ''))
    } catch {
      // The host logger may also be unavailable.
    }
  }
  let pending = prune(new Date()).catch((error) => report(error))
  function write(entry: Entry) {
    const { step, repo, number, error } = entry
    const now = new Date()
    pending = pending
      .then(async () => {
        const day = localDate(now)
        if (lastDay !== day) {
          await prune(now)
          lastDay = day
        }
        const line = [
          now.toISOString(),
          now.toTimeString(),
          step,
          repo ?? '',
          number === undefined ? '' : '#' + number,
          errorText(error),
        ]
          .map((field) => field.replace(/\r\n|[\r\n]/g, '\\n').replace(/\t/g, '\\t'))
          .join('\t')
        await appendFile(join(logs, day + '.log'), line + '\n', { flag: 'a' })
      })
      .catch((cause) => report(cause, entry))
    return pending
  }
  function logged<I extends { repo: string; number: number } | { key: string }, R extends object>(
    initialStep: string,
    run: (input: I, setStep: (step: string) => void) => Promise<R>,
    failureOf: (result: R) => unknown = (result) => ('ok' in result && !result.ok ? result : undefined),
  ) {
    return async (input: I) => {
      let step = initialStep
      const ref = 'repo' in input ? { repo: input.repo, number: input.number } : {}
      try {
        const result = await run(input, (value) => {
          step = value
        })
        const error = failureOf(result)
        if (error) await write({ step, ...ref, error })
        return result
      } catch (error) {
        await write({ step, ...ref, error })
        throw error
      }
    }
  }
  let lastStorageFailure = -Infinity
  async function storageFailure(storage: StorageApi, key: string, valueBytes: number, error: string) {
    if (Date.now() - lastStorageFailure < 60_000) return
    lastStorageFailure = Date.now()
    const groups: Record<string, number> = Object.create(null)
    try {
      const keys = await storage.keys()
      let totalBytes = 2
      for (const [index, k] of keys.entries()) {
        const size =
          Buffer.byteLength(JSON.stringify(k)) +
          1 +
          Buffer.byteLength(JSON.stringify(await storage.get(k))) +
          Number(index > 0)
        totalBytes += size
        const group = storageGroup(k)
        groups[group] = (groups[group] ?? 0) + size
      }
      await write({ step: 'storage write', error: { key, valueBytes, error, totalBytes, groups } })
    } catch (cause) {
      await write({ step: 'storage write', error: { key, valueBytes, error, inventoryError: String(cause) } })
    }
  }
  function loggedStorage(orca: OrcaWorkerApi): StorageApi {
    orca.panels.handle('panel.failure', async (error) => {
      await write({ step: error.method, error })
      return null
    })
    orca.panels.handle('storage.failure', async ({ key, valueBytes, error }) => {
      await storageFailure(orca.storage, key, valueBytes, error)
      return null
    })
    return {
      get: (key) => orca.storage.get(key),
      keys: () => orca.storage.keys(),
      delete: (key) => orca.storage.delete(key),
      onDidChange: (listener) => orca.storage.onDidChange(listener),
      async set(key, value) {
        try {
          await orca.storage.set(key, value)
        } catch (error) {
          await storageFailure(orca.storage, key, Buffer.byteLength(JSON.stringify(value)), String(error))
          throw error
        }
      },
    }
  }
  return { write, logged, loggedStorage }
}
