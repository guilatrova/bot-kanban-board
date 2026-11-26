import { createHash } from 'node:crypto'
import type { StorageApi } from 'orca'
import type { Snapshot } from '../protocol'

type SourceName = keyof Snapshot['sources']
type Manifest = { version: 1; at: number; hash: string; count: number }
const chunkBytes = 72 * 1024

function isManifest(value: unknown): value is Manifest {
  const record = value as Partial<Manifest> | null
  return (
    record?.version === 1 &&
    typeof record.at === 'number' &&
    record.at > 0 &&
    typeof record.hash === 'string' &&
    /^[a-f0-9]{64}$/.test(record.hash) &&
    typeof record.count === 'number' &&
    Number.isSafeInteger(record.count) &&
    record.count > 0
  )
}

export function savedBoard(storage: StorageApi, data: Snapshot, log: (message: string) => void) {
  const manifests = new Map<SourceName, Manifest>()
  async function load(source: SourceName) {
    const key = 'snapshot-' + source
    try {
      const record = await storage.get(key)
      if (!isManifest(record)) return
      const parts = await Promise.all(
        Array.from({ length: record.count }, (_, i) => storage.get(key + record.hash + i)),
      )
      if (!parts.every((p): p is string => typeof p === 'string')) return
      const bytes = Buffer.from(parts.join(''), 'base64')
      if (createHash('sha256').update(bytes).digest('hex') !== record.hash) return
      const saved = JSON.parse(bytes.toString()) as Snapshot
      if (source === 'orca') {
        if (!Array.isArray(saved.computers)) return
        data.computers = saved.computers
        data.itemsAt = record.at
      } else {
        if (
          !Array.isArray(saved.prs) ||
          !Array.isArray(saved.merged) ||
          !saved.repos ||
          typeof saved.total !== 'number'
        )
          return
        data.prs = saved.prs
        data.merged = saved.merged
        data.repos = saved.repos
        data.total = saved.total
        data.prsAt = record.at
      }
      data.sources[source] = { status: 'stale', at: record.at }
      manifests.set(source, record)
    } catch (error) {
      log(String(error))
    }
  }
  async function save(source: SourceName) {
    const key = 'snapshot-' + source
    const { computers, prs, merged, repos, total } = data
    const bytes = Buffer.from(JSON.stringify(source === 'orca' ? { computers } : { prs, merged, repos, total }))
    const hash = createHash('sha256').update(bytes).digest('hex')
    const count = Math.ceil(bytes.length / chunkBytes)
    const record: Manifest = { version: 1, at: data.sources[source].at, hash, count }
    const previous = manifests.get(source)
    const written: string[] = []
    try {
      if (hash !== previous?.hash) {
        for (let i = 0; i < count; i++) {
          const part = key + hash + i
          await storage.set(part, bytes.subarray(i * chunkBytes, (i + 1) * chunkBytes).toString('base64'))
          written.push(part)
        }
      }
      await storage.set(key, record)
      manifests.set(source, record)
    } catch (error) {
      log(String(error))
      await Promise.allSettled(written.map((part) => storage.delete(part)))
      return
    }
    if (previous && previous.hash !== hash)
      await Promise.allSettled(
        Array.from({ length: previous.count }, (_, i) => storage.delete(key + previous.hash + i)),
      )
  }
  return { load, save }
}
