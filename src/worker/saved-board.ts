import { bodyIssueRefs } from '../core/normalize'
import type { IssueRef } from '../core/model'
import { isChunkRecord, readChunks, writeChunks, type ChunkRecord } from './chunked-storage'
import type { StorageApi } from 'orca'
import type { Snapshot } from '../protocol'

type SourceName = keyof Snapshot['sources']
type Manifest = ChunkRecord & { version: 1; at: number }

function migratePr<T extends { repo: string; mentions?: IssueRef[] }>(pr: T & { body?: string }): T {
  if (typeof pr.body === 'string') {
    pr.mentions = bodyIssueRefs(pr.body, pr.repo)
    delete pr.body
  }
  return pr
}

function isManifest(value: unknown): value is Manifest {
  return (
    isChunkRecord(value) &&
    'version' in value &&
    value.version === 1 &&
    'at' in value &&
    typeof value.at === 'number' &&
    value.at > 0
  )
}

export function savedBoard(storage: StorageApi, data: Snapshot, log: (message: string) => void) {
  const manifests = new Map<SourceName, ChunkRecord>()
  async function load(source: SourceName) {
    const key = 'snapshot-' + source
    try {
      const record = await storage.get(key)
      if (!isManifest(record)) return
      const bytes = await readChunks(storage, key, record)
      if (!bytes) return
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
        data.prs = saved.prs.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).map(migratePr)
        data.merged = saved.merged.map(migratePr)
        data.repos = saved.repos
        data.total = saved.total
        if (
          typeof saved.login === 'string' &&
          typeof saved.allOpenLoaded === 'boolean' &&
          Number.isFinite(Date.parse(saved.syncedAt ?? ''))
        ) {
          data.login = saved.login
          data.allOpenLoaded = saved.allOpenLoaded
          data.syncedAt = saved.syncedAt
        }
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
    const { computers, prs, merged, repos, total, login, syncedAt, allOpenLoaded } = data
    const bytes = Buffer.from(
      JSON.stringify(source === 'orca' ? { computers } : { prs, merged, repos, total, login, syncedAt, allOpenLoaded }),
    )
    try {
      const metadata = { version: 1, at: data.sources[source].at }
      const record = await writeChunks(storage, key, bytes, metadata, manifests.get(source))
      manifests.set(source, record)
    } catch (error) {
      log(String(error))
    }
  }
  return { load, save }
}
