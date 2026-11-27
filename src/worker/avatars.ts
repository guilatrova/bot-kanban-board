import { deleteChunks, digest, isChunkRecord, readChunks, writeChunks } from './chunked-storage'
import { stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dedupe } from './dedupe'
import { responseBudget } from '../protocol'
import { botKey } from '../core/model'
import type { OrcaWorkerApi } from 'orca/worker'
import { join } from 'node:path'
import type { StorageApi } from 'orca'
import type { Computer } from '../core/model'
import { withTerminal } from './terminal'

const maxStoredBytes = 20 * 1024
const execute = promisify(execFile)
const cacheKey = (computer: string, bot: string) => 'avatar-' + digest(JSON.stringify([computer, bot])).slice(0, 24)
const validPng = (bytes: Buffer) => bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'

const resize = [
  'set -e',
  'tmp=$(mktemp -d)',
  'trap "rm -rf \\"$tmp\\"" EXIT',
  'file="$tmp/avatar.png"',
  'cp avatar.png "$file"',
  'if command -v sips >/dev/null; then sips -Z 128 "$file" >/dev/null; elif command -v magick >/dev/null; then magick "$file" -resize "128x128>" "$file"; else convert "$file" -resize "128x128>" "$file"; fi',
  'test "$(wc -c < "$file")" -le ' + maxStoredBytes,
]
// Orca terminal previews retain about 32 KiB. Request one 18 KiB block at a time.
const transferSize = 18 * 1024
const transfer =
  " exec bash -c '" +
  [
    'hash=$(shasum -a 256 < avatar.png)',
    'echo BOARDHASH=${hash%% *}',
    'read -r -t 60 start',
    ...resize,
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
    await send('resize')
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
    return { hash, bytes }
  })
}

export function avatars(storage: StorageApi, log: (error: unknown) => Promise<void>) {
  const warned = new Set<string>()
  async function get(computer: string, bot: string, home: string | null, path: string) {
    if (!home) return null
    const key = cacheKey(computer, bot)
    return dedupe(key, async () => {
      try {
        const meta = await storage.get(key)
        const record = isChunkRecord(meta) ? meta : undefined
        const existing = record ? await readChunks(storage, key, record) : null
        const previous =
          existing && record && 'source' in record && typeof record.source === 'string' ? record.source : null
        let source: string, bytes: Buffer | null
        if (computer === 'local') {
          const info = await stat(join(home, 'avatar.png'))
          source = info.mtimeMs + ':' + info.size
          bytes =
            source === previous
              ? null
              : (
                  await execute('bash', ['-c', [...resize, 'cat "$file"'].join('; ')], {
                    cwd: home,
                    encoding: 'buffer',
                    maxBuffer: 256 * 1024,
                  })
                ).stdout
        } else {
          const image = await remoteImage(path, computer, home, previous)
          source = image.hash
          bytes = image.bytes
        }
        const image = bytes ?? existing
        if (!image || !validPng(image) || image.length > maxStoredBytes) throw Error('Invalid or oversized avatar')
        if (bytes) await writeChunks(storage, key, bytes, { source, computer }, record)
        return image.toString('base64')
      } catch (error) {
        if (!warned.has(key)) {
          warned.add(key)
          await log({ key, error })
        }
        return null
      }
    })
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
      for (const b of c.source.value.bots) live.add(cacheKey(c.key, b.name))
    }
    const roster = JSON.stringify([complete, [...known].sort(), [...live].sort()])
    if (roster === lastRoster) return
    const keys = await storage.keys()
    const groups = new Map<string, string[]>()
    for (const key of keys) {
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
      for (const key of group) await storage.delete(key)
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

export function serveAvatars(
  orca: OrcaWorkerApi,
  avatar: ReturnType<typeof avatars>,
  computers: () => Computer[],
  path: () => Promise<string>,
) {
  orca.panels.handle('avatars.get', async ({ keys }) => {
    const wanted = new Set(keys)
    const avatars: Record<string, string> = {}
    const remaining: string[] = []
    let size = Buffer.byteLength(JSON.stringify({ avatars, remaining: keys })) + 128
    const executable = await path()
    const requests = computers()
      .flatMap((c) => {
        if (!c.source.ok) return []
        const { bots, workspaces } = c.source.value
        return bots.map((b) => ({
          key: botKey(c.key, b.name),
          computer: c.key,
          bot: b.name,
          home: b.home ?? workspaces.find((w) => w.bot === b.name && w.home)?.home ?? null,
        }))
      })
      .filter((b) => wanted.has(b.key))
    for (const b of requests) {
      if (size + Math.ceil(maxStoredBytes / 3) * 4 > responseBudget) {
        remaining.push(b.key)
        continue
      }
      const data = await avatar.get(b.computer, b.bot, b.home, executable)
      if (data) {
        avatars[b.key] = data
        size += data.length + 4
      }
    }
    return { avatars, remaining }
  })
}
