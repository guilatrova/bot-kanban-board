import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { Source } from '../core/model'

const execute = promisify(execFile)
const sessionKeys = [
  'ORCA_AGENT_SESSION_ID',
  'ORCA_AGENT_SESSION_SPAWN_TOKEN',
  'ORCA_BOT_TOOLS_TOKEN',
  'ORCA_STRUCTURED_SESSION',
]
type Binary = 'orca' | 'gh'

async function binaryPath(binary: Binary, configured: string): Promise<string> {
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  const dirs = [
    ...(process.env.PATH || '').split(delimiter).filter(Boolean),
    join(config, 'orca/cli/bin'),
    join(config, 'orca/linux-orca-cli-shim'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  const paths = configured ? [configured] : dirs.map((dir) => join(dir, binary))
  for (const path of paths) {
    try {
      await access(path, constants.X_OK)
      return path
    } catch {
      continue
    }
  }
  throw new Error(`Cannot find executable ${binary}`)
}

export function commandLabel(binary: Binary, args: string[]) {
  return [binary, ...args.slice(0, binary === 'orca' ? 3 : 1).filter((arg) => !arg.startsWith('-'))].join(' ')
}

export async function runCli(
  binary: Binary,
  args: string[],
  configured = '',
  format: 'json' | 'text' = 'json',
): Promise<Source<unknown>> {
  const headers = binary === 'gh' && args[0] === 'api' && !args.includes('--paginate')
  const command = commandLabel(binary, args)
  const env = { ...process.env }
  if (sessionKeys.some((key) => key in env)) {
    return {
      ok: false,
      command,
      message: 'The board is running inside a bot session.',
      next: 'Open it from the Orca desktop app as yourself.',
    }
  }
  try {
    const path = await binaryPath(binary, configured)
    const { stdout } = await execute(path, headers ? [args[0]!, '-i', ...args.slice(1)] : args, {
      env,
      timeout: 45_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    if (format === 'text') return { ok: true, value: stdout }
    const json: unknown = JSON.parse(headers ? stdout.replace(/^HTTP\/[^]*?\r?\n\r?\n/, '') : stdout)
    if (binary === 'gh') return { ok: true, value: json }
    if (json && typeof json === 'object' && 'ok' in json && json.ok === true && 'result' in json)
      return { ok: true, value: json.result }
    throw new Error(envelopeMessage(json) || 'Invalid Orca response')
  } catch (error) {
    let message = error instanceof Error ? error.message.split('\n').slice(-2).join(' ').trim() : 'Command failed'
    let status: number | undefined,
      resetAt: number | undefined,
      rateLimited = false
    if (error && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string') {
      const output = error.stdout
      const http = output.match(/^HTTP\/[\d.]+ (\d{3})/i) ?? message.match(/HTTP (\d{3})/i)
      status = http ? Number(http[1]) : undefined
      const head = output.split(/\r?\n\r?\n/, 1)[0] ?? ''
      const reset = head.match(/^x-ratelimit-reset:\s*(\d+)/im)
      const wait = head.match(/^retry-after:[ \t]*([^\r\n]+)/im)
      rateLimited = Boolean(wait || /^x-ratelimit-remaining:\s*0\s*$/im.test(head))
      const retryAt = wait
        ? /^\d+$/.test(wait[1]!.trim())
          ? Date.now() + Number(wait[1]) * 1000
          : Date.parse(wait[1]!)
        : 0
      resetAt = Math.max(Number(reset?.[1] ?? 0) * 1000, retryAt || 0) || undefined
      try {
        const payload: unknown = JSON.parse(output.replace(/^HTTP\/[^]*?\r?\n\r?\n/, ''))
        if (
          binary === 'gh' &&
          payload &&
          typeof payload === 'object' &&
          'message' in payload &&
          typeof payload.message === 'string'
        )
          message = payload.message
        else message = envelopeMessage(payload) || message
      } catch {
        /* No Orca envelope. */
      }
    }
    return {
      ok: false,
      command,
      message,
      ...(status ? { status } : {}),
      ...(resetAt ? { resetAt } : {}),
      ...(rateLimited ? { rateLimited } : {}),
      next:
        binary === 'gh'
          ? status === 401 || /not logged (?:in|into)|gh auth login/i.test(message)
            ? 'Run gh auth login.'
            : 'Check the GitHub connection and refresh.'
          : 'Check the Orca path setting and computer connection, then refresh.',
    }
  }
}

function envelopeMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object' || !('error' in json)) return null
  const error = json.error
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : null
}
