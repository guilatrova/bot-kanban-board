import { open } from 'node:fs/promises'
import { join } from 'node:path'
export async function avatar(home: string | null) {
  if (!home) return null
  try {
    const file = await open(join(home, 'avatar.png'), 'r')
    try {
      if ((await file.stat()).size > 1024 * 1024) return null
      const data = await file.readFile()
      return data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
        ? 'data:image/png;base64,' + data.toString('base64')
        : null
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}
