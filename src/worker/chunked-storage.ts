import { createHash } from 'node:crypto'
import type { JsonValue, StorageApi } from 'orca'

export const chunkSize = 72 * 1024
export const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
export type ChunkRecord = { hash: string; count: number }

export function isChunkRecord(value: unknown): value is ChunkRecord {
  const record = value as Partial<ChunkRecord> | null
  return (
    typeof record?.hash === 'string' &&
    /^[a-f0-9]{64}$/.test(record.hash) &&
    typeof record.count === 'number' &&
    Number.isSafeInteger(record.count) &&
    record.count > 0
  )
}

export async function readChunks(storage: StorageApi, key: string, record: ChunkRecord) {
  const parts = await Promise.all(Array.from({ length: record.count }, (_, i) => storage.get(key + record.hash + i)))
  if (!parts.every((p): p is string => typeof p === 'string')) return null
  const bytes = Buffer.from(parts.join(''), 'base64')
  return digest(bytes) === record.hash ? bytes : null
}

export async function writeChunks(
  storage: StorageApi,
  key: string,
  bytes: Buffer,
  metadata: Record<string, JsonValue>,
  previous?: ChunkRecord,
): Promise<ChunkRecord> {
  const hash = digest(bytes)
  const count = Math.ceil(bytes.length / chunkSize)
  const written: string[] = []
  try {
    if (hash !== previous?.hash) {
      for (let i = 0; i < count; i++) {
        const part = key + hash + i
        await storage.set(part, bytes.subarray(i * chunkSize, (i + 1) * chunkSize).toString('base64'))
        written.push(part)
      }
    }
    await storage.set(key, { ...metadata, hash, count })
  } catch (error) {
    await Promise.allSettled(written.map((part) => storage.delete(part)))
    throw error
  }
  if (previous && previous.hash !== hash)
    await Promise.allSettled(Array.from({ length: previous.count }, (_, i) => storage.delete(key + previous.hash + i)))
  return { hash, count }
}
