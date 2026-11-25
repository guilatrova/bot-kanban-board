import { open } from 'node:fs/promises'
import { join } from 'node:path'

// Full chunks must end on a base64 triplet and fit a single frame response.
const chunkSize = 72 * 1024
export async function avatar(home: string | null, offset: number) {
  if (!home || !Number.isSafeInteger(offset) || offset < 0 || offset % chunkSize !== 0) return null
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
      if (!offset && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
      return { data: buffer.toString('base64'), next: offset + length < size ? offset + length : null }
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}
