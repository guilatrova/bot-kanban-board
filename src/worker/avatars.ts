import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageApi } from 'orca'
import { obj, rows, str } from '../core/normalize'
import { runCli } from './cli'

const freshness = 10 * 60_000
const chunkSize = 72 * 1024
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

// Orca terminal previews retain about 32 KiB. Request one 18 KiB block at a time.
const transferSize = 18 * 1024
const transfer =
  "sh -c '" +
  [
    'set -e',
    'hash=$(shasum -a 256 < avatar.png)',
    'echo BOARDHASH=${hash%% *}',
    'while read -r n; do echo BOARDSTART=$n',
    `dd if=avatar.png bs=${transferSize} skip="$n" count=1 2>/dev/null | base64 | tr -d "\\n" | fold -w 1024`,
    'printf "\\nBOARDDONE=%s\\n" "$n"',
    'done',
  ].join('; ') +
  "'"

async function remoteImage(path: string, computer: string, home: string, previous: string | null) {
  async function terminal(args: string[]) {
    const r = await runCli('orca', ['terminal', ...args, '--environment', computer, '--json'], path)
    if (!r.ok) throw Error(r.message)
    return obj(r.value)
  }
  const created = await terminal([
    'create',
    '--worktree',
    'path:' + home,
    '--title',
    'Board avatar',
    '--command',
    transfer,
  ])
  const handle = ['--terminal', str(obj(created.terminal), 'handle')]
  async function until(marker: RegExp) {
    const deadline = Date.now() + 10_000
    do {
      const r = await terminal(['read', ...handle, '--limit', '2000'])
      const lines = rows(obj(r.terminal).tail).filter((v): v is string => typeof v === 'string')
      const index = lines.findIndex((line) => marker.test(line))
      if (index >= 0) return lines.slice(0, index + 1)
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    throw Error('Avatar transfer timed out')
  }
  try {
    const hash = (await until(/^BOARDHASH=[a-f0-9]{64}$/)).at(-1)!.slice(10)
    if (hash === previous) return { hash, bytes: null }
    const blocks: Buffer[] = []
    for (let i = 0; ; i++) {
      await terminal(['send', ...handle, '--text', String(i), '--enter'])
      const lines = await until(new RegExp('^BOARDDONE=' + i + '$'))
      const start = lines.indexOf('BOARDSTART=' + i)
      if (start < 0) throw Error('Incomplete avatar block')
      const bytes = Buffer.from(lines.slice(start + 1, -1).join(''), 'base64')
      blocks.push(bytes)
      if (bytes.length < transferSize) break
    }
    const bytes = Buffer.concat(blocks)
    if (digest(bytes) !== hash) throw Error('Avatar changed during transfer')
    return { hash, bytes }
  } finally {
    await terminal(['close', ...handle])
  }
}

export function avatars(storage: StorageApi) {
  const jobs = new Map<string, { time: number; picture: Promise<Buffer | null> }>()
  async function load(key: string, computer: string, home: string, path: string) {
    const meta = await storage.get(key)
    const record = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
    const previous = typeof record.hash === 'string' ? record.hash : null
    async function cached() {
      if (!previous || typeof record.count !== 'number') return null
      const chunks = await Promise.all(Array.from({ length: record.count }, (_, i) => storage.get(key + previous + i)))
      if (!chunks.every((v): v is string => typeof v === 'string')) return null
      const bytes = Buffer.from(chunks.join(''), 'base64')
      return digest(bytes) === previous ? bytes : null
    }
    const existing = await cached()
    if (existing && typeof record.time === 'number' && Date.now() - record.time < freshness) return existing
    const local = computer === 'local' ? await readFile(join(home, 'avatar.png')) : null
    const { hash, bytes } = local
      ? { hash: digest(local), bytes: local }
      : await remoteImage(path, computer, home, existing ? previous : null)
    const image = bytes ?? existing
    if (!image || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
    const count = Math.ceil(image.length / chunkSize)
    if (hash !== previous || !existing) {
      for (let i = 0; i < count; i++)
        await storage.set(key + hash + i, image.subarray(i * chunkSize, (i + 1) * chunkSize).toString('base64'))
    }
    await storage.set(key, { hash, count, time: Date.now() })
    if (previous && previous !== hash && typeof record.count === 'number')
      for (let i = 0; i < record.count; i++) await storage.delete(key + previous + i)
    return image
  }
  return async (computer: string, bot: string, home: string | null, offset: number, path: string) => {
    if (!home || !Number.isSafeInteger(offset) || offset < 0 || offset % chunkSize) return null
    const key = 'avatar-' + digest(JSON.stringify([computer, bot])).slice(0, 24)
    let job = jobs.get(key)
    if (!job || (!offset && Date.now() - job.time >= freshness)) {
      job = { time: Date.now(), picture: load(key, computer, home, path).catch(() => null) }
      jobs.set(key, job)
    }
    const bytes = await job.picture
    if (!bytes || offset >= bytes.length) return null
    const end = Math.min(bytes.length, offset + chunkSize)
    return { data: bytes.subarray(offset, end).toString('base64'), next: end < bytes.length ? end : null }
  }
}
