import { count } from './metrics'
import { deleteChunks, digest, isChunkRecord, readChunks, writeChunks } from './chunked-storage'
import { dedupe } from './dedupe'
import type { OrcaWorkerApi } from 'orca/worker'
import type { StorageApi } from 'orca'
import type { Snapshot } from '../protocol'
import { prKey, type PullRequest } from '../core/model'
import { files } from './sources/github'
import type { failureLog } from './failure-log'
const fileKey = (pr: PullRequest) =>
  pr.sha && pr.baseSha ? 'files-' + digest(JSON.stringify([prKey(pr), pr.sha, pr.baseSha])) : null
export function serveFiles(
  orca: OrcaWorkerApi,
  storage: StorageApi,
  data: Snapshot,
  path: (key: string) => Promise<string>,
  logged: ReturnType<typeof failureLog>['logged'],
) {
  orca.panels.handle(
    'pr.files',
    logged('PR files', async (input) => {
      if (data.demo) return { ok: true as const, value: { data: '[]', end: true } }
      const pr = data.prs.find((p) => prKey(p) === input.key && p.updated === input.updated),
        key = input.key + '@' + input.updated
      if (!pr)
        return {
          ok: false as const,
          command: 'gh api pulls/files',
          message: 'The pull request changed.',
          next: 'Reopen its drawer.',
        }
      const cacheKey = fileKey(pr)
      const payload = await dedupe('pr.files:' + (cacheKey ?? key), async () => {
        const record = cacheKey ? await storage.get(cacheKey) : null
        if (cacheKey && isChunkRecord(record)) {
          const bytes = await readChunks(storage, cacheKey, record)
          if (bytes) count('hits')
          if (bytes) return { ok: true as const, value: bytes.toString() }
        }
        count('misses')
        const result = await files(await path('ghPath'), pr)
        if (!result.ok) return result
        const json = JSON.stringify(result.value)
        if (cacheKey && data.prs.some((p) => prKey(p) === input.key && fileKey(p) === cacheKey))
          await writeChunks(storage, cacheKey, Buffer.from(json), {}).catch((e) => orca.log(String(e)))
        return { ok: true as const, value: json }
      })
      if (!payload.ok) return payload
      const json = payload.value
      const end = input.offset + 32000
      return { ok: true as const, value: { data: json.slice(input.offset, end), end: end >= json.length } }
    }),
  )
  let last = ''
  return async function prune() {
    const live = new Set(data.prs.map(fileKey).filter((k) => k !== null))
    const signature = JSON.stringify([...live].sort())
    if (last === signature) return
    for (const key of await storage.keys()) {
      if (!/^files-[a-f0-9]{64}$/.test(key) || live.has(key)) continue
      const record = await storage.get(key)
      if (isChunkRecord(record)) await deleteChunks(storage, key, record)
    }
    last = signature
  }
}
