import { randomUUID } from 'node:crypto'
import { obj, rows, str } from '../core/normalize'
import { runCli } from './cli'

interface TerminalSession {
  send(text: string): Promise<void>
  until(marker: RegExp, timeoutMs?: number): Promise<string[]>
}

export async function withTerminal<T>(
  path: string,
  computer: string,
  home: string,
  label: string,
  command: string,
  work: (session: TerminalSession) => Promise<T>,
) {
  const title = label + ' ' + randomUUID()
  const workspace = ['--worktree', 'path:' + home]
  async function terminal(args: string[]) {
    const result = await runCli('orca', ['terminal', ...args, '--environment', computer, '--json'], path)
    if (!result.ok) throw Error(result.message)
    return obj(result.value)
  }
  let handle = ''
  try {
    const created = await terminal(['create', ...workspace, '--title', title, '--command', command])
    handle = str(obj(created.terminal), 'handle')
    if (!handle) throw Error('Missing terminal handle')
    return await work({
      async send(text) {
        await terminal(['send', '--terminal', handle, '--text', text, '--enter'])
      },
      async until(marker, timeoutMs = 10000) {
        const deadline = Date.now() + timeoutMs
        do {
          const reply = await terminal(['read', '--terminal', handle, '--limit', '2000'])
          const lines = rows(obj(reply.terminal).tail).filter((v): v is string => typeof v === 'string')
          const index = lines.findIndex((line) => marker.test(line))
          if (index >= 0) return lines.slice(0, index + 1)
          await new Promise((resolve) => setTimeout(resolve, 100))
        } while (Date.now() < deadline)
        throw Error(label + ' timed out')
      },
    })
  } finally {
    if (!handle) {
      const list = await terminal(['list', ...workspace, '--limit', '1000'])
      const owned = rows(list.terminals)
        .map(obj)
        .find((t) => t.title === title)
      if (owned) handle = str(owned, 'handle')
    }
    if (handle) await terminal(['close', '--terminal', handle])
  }
}
