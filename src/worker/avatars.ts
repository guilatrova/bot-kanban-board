import { chunkSize, deleteChunks, digest, isChunkRecord, readChunks, writeChunks } from './chunked-storage'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageApi } from 'orca'
import type { Computer } from '../core/model'
import { withTerminal } from './terminal'

const maxStoredBytes = 64 * 1024
const freshness = 6 * 60 * 60_000
const cacheKey = (computer: string, bot: string) => 'avatar-' + digest(JSON.stringify([computer, bot])).slice(0, 24)
const validPng = (bytes: Buffer) => bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'

async function localAvatar(home: string, offset: number) {
  try {
    const file = await open(join(home, 'avatar.png'), 'r')
    try {
      const size = (await file.stat()).size
      const length = Math.min(chunkSize, size - offset)
      if (length <= 0) return null
      const buffer = Buffer.alloc(length)
      let read = 0
      while (read < length) {
        const { bytesRead } = await file.read(buffer, read, length - read, offset + read)
        if (!bytesRead) return null
        read += bytesRead
      }
      if (!offset && !validPng(buffer)) return null
      return { data: buffer.toString('base64'), next: offset + length < size ? offset + length : null }
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}

// Orca terminal previews retain about 32 KiB. Request one 18 KiB block at a time.
const transferSize = 18 * 1024
const transfer =
  " exec bash -c '" +
  [
    'set -e',
    'tmp=$(mktemp -d)',
    'trap "rm -rf \\"$tmp\\"" EXIT',
    'file="$tmp/avatar.png"',
    'cp avatar.png "$file"',
    'if command -v sips >/dev/null; then sips -Z 128 "$file" >/dev/null || file=avatar.png; elif command -v magick >/dev/null; then magick "$file" -resize "128x128>" "$file" || file=avatar.png; elif command -v convert >/dev/null; then convert "$file" -resize "128x128>" "$file" || file=avatar.png; fi',
    'hash=$(shasum -a 256 < "$file")',
    'echo BOARDHASH=${hash%% *}',
    'while read -r -t 60 n; do echo BOARDSTART=$n',
    `dd if="$file" bs=${transferSize} skip="$n" count=1 2>/dev/null | base64 | tr -d "\\n" | fold -w 1024`,
    'printf "\\nBOARDDONE=%s\\n" "$n"',
    'done',
  ].join('; ') +
  "'"

async function remoteImage(path: string, computer: string, home: string, previous: string | null) {
  return withTerminal(path, computer, home, 'Board avatar', transfer, async ({ send, until }) => {
    const hash = (await until(/^BOARDHASH=[a-f0-9]{64}$/)).at(-1)!.slice(10)
    if (hash === previous) return { hash, bytes: null }
    const blocks: Buffer[] = []
    for (let i = 0; ; i++) {
      await send(String(i))
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
  })
}

export function avatars(storage: StorageApi, log: (error: unknown) => Promise<void>) {
  const jobs = new Map<string, { time: number; picture: Promise<Buffer | null> }>()
  async function load(key: string, computer: string, home: string | null, path: string, memory: Buffer | null) {
    const meta = await storage.get(key)
    const previous = isChunkRecord(meta) ? meta : undefined
    const existing = memory ?? (previous ? await readChunks(storage, key, previous) : null)
    if (!home) return existing
    const verified = existing ? digest(existing) : null
    const result = await remoteImage(path, computer, home, verified).catch(() => null)
    if (!result) return existing
    const image = result.bytes ?? existing
    if (!image || !validPng(image)) return existing
    if (image.length > maxStoredBytes) {
      await log({ key, bytes: image.length, message: 'Avatar exceeds 64 KiB and is cached in memory only.' })
      if (previous) await deleteChunks(storage, key, previous).catch(log)
      return image
    }
    try {
      await writeChunks(
        storage,
        key,
        image,
        { computer },
        !existing && previous?.hash === result.hash ? undefined : previous,
      )
    } catch (error) {
      await log({ key, bytes: image.length, error })
    }
    return image
  }
  async function get(computer: string, bot: string, home: string | null, offset: number, path: string) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % chunkSize) return null
    if (computer === 'local') return home ? localAvatar(home, offset) : null
    const key = cacheKey(computer, bot)
    let job = jobs.get(key)
    if (!job || (!offset && Date.now() - job.time >= freshness)) {
      const last = job?.picture ?? Promise.resolve(null)
      job = {
        time: Date.now(),
        picture: last.then((image) => load(key, computer, home, path, image).catch(() => image)),
      }
      jobs.set(key, job)
    }
    const bytes = await job.picture
    if (!bytes || offset >= bytes.length) return null
    const end = Math.min(bytes.length, offset + chunkSize)
    return { data: bytes.subarray(offset, end).toString('base64'), next: end < bytes.length ? end : null }
  }
  let lastRoster = ''
  async function prune(computers: Computer[]) {
    const live = new Set<string>(),
      known = new Set<string>()
    let complete = true
    for (const c of computers) {
      if (!c.source.ok || c.key === 'discovery') {
        complete = false
        continue
      }
      known.add(c.key)
      if (c.key !== 'local') for (const b of c.source.value.bots) live.add(cacheKey(c.key, b.name))
    }
    const roster = JSON.stringify([complete, [...known].sort(), [...live].sort()])
    if (roster === lastRoster) return
    const keys = await storage.keys()
    const groups = new Map<string, string[]>()
    for (const key of [...keys, ...jobs.keys()]) {
      const base = key.match(/^avatar-[a-f0-9]{24}/)?.[0]
      if (!base || live.has(base)) continue
      const group = groups.get(base) ?? []
      group.push(key)
      groups.set(base, group)
    }
    for (const [base, group] of groups) {
      if (!complete) {
        const m = await storage.get(base)
        if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.computer !== 'string' || !known.has(m.computer))
          continue
      }
      const job = jobs.get(base)
      if (job) {
        await job.picture
        jobs.delete(base)
      }
      const stale = job ? (await storage.keys()).filter((k) => k.startsWith(base)) : group
      for (const key of stale) await storage.delete(key)
    }
    lastRoster = roster
  }
  async function clearOversized() {
    for (const key of await storage.keys()) {
      if (!/^avatar-[a-f0-9]{24}$/.test(key)) continue
      const record = await storage.get(key)
      if (!isChunkRecord(record)) continue
      if (record.count > 1 || ((await readChunks(storage, key, record))?.length ?? 0) > maxStoredBytes)
        await deleteChunks(storage, key, record)
    }
  }
  return { get, prune, clearOversized }
}
