import { count } from './metrics'
import { digest, isChunkRecord, readChunks, writeChunks } from './chunked-storage'
import { dedupe } from './dedupe'
import type { OrcaWorkerApi } from 'orca/worker'
import type { StorageApi } from 'orca'
import type { Snapshot } from '../protocol'
import { prKey } from '../core/model'
import { files } from './sources/github'
import type { failureLog } from './failure-log'
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
      const cacheKey = pr.sha && pr.baseSha ? 'files-' + digest(JSON.stringify([input.key, pr.sha, pr.baseSha])) : null
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
        if (cacheKey) await writeChunks(storage, cacheKey, Buffer.from(json), {}).catch((e) => orca.log(String(e)))
        return { ok: true as const, value: json }
      })
      if (!payload.ok) return payload
      const json = payload.value
      const end = input.offset + 32000
      return { ok: true as const, value: { data: json.slice(input.offset, end), end: end >= json.length } }
    }),
  )
}
