import { randomUUID } from 'node:crypto'
import type { Computer } from '../core/model'
import type { BotMessage } from '../protocol'
import { withTerminal } from './terminal'

export async function sendBotMessage(path: string, computers: Computer[], input: BotMessage, log: (s: string) => void) {
  const roster = computers.find((c) => c.key === input.computer)?.source
  const bot = roster?.ok && roster.value.bots.find((b) => b.name === input.botName)
  if (!bot || !roster || !roster.ok) {
    log('Bot message recipient unavailable')
    return false
  }
  const home = bot.home ?? roster.value.workspaces.find((w) => w.bot === bot.name && w.home)?.home
  if (!home) {
    log('Bot workspace unavailable')
    return false
  }
  const marker = 'BOARDRESULT' + randomUUID()
  // NUL-delimited arguments preserve whitespace and shell metacharacters.
  // The recipient terminal sees only a static bash script, base64 and the marker.
  const args = [
    '--to',
    'bot:' + bot.name,
    '--chat',
    'new',
    '--type',
    'question',
    '--subject',
    input.subject,
    '--body',
    input.body,
  ]
  const payload = Buffer.from(args.join('\0') + '\0').toString('base64')
  const script = [
    'args=()',
    'while IFS= read -r -d "" arg; do args+=("$arg"); done < <(printf "%s" "$1" | base64 --decode)',
    'orca orchestration send "${args[@]}"',
    'printf "\\n%s%d\\n" "$2" "$?"',
  ].join('; ')
  const command = `bash -c '${script}' _ ${payload} ${marker}`
  try {
    return await withTerminal(path, input.computer, home, 'Board message', command, async ({ until }) => {
      const output = await until(new RegExp('^' + marker + '[0-9]+$'), 60000)
      if (output.at(-1) !== marker + '0') throw Error(output.slice(-12).join('\n'))
      return true
    })
  } catch (error) {
    log(String(error))
    return false
  }
}
