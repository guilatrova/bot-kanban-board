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
        const line = [now.toISOString(), step, repo ?? '', number === undefined ? '' : '#' + number, errorText(error)]
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
  return { write, logged }
}
