import { randomUUID } from 'node:crypto'
import type { Computer } from '../core/model'
import { obj, rows, str } from '../core/normalize'
import type { BotMessage } from '../protocol'
import { runCli } from './cli'

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
  const terminal = async (args: string[]) => {
    const result = await runCli('orca', ['terminal', ...args, '--environment', input.computer, '--json'], path)
    if (!result.ok) throw Error(result.message)
    return obj(result.value)
  }
  const marker = 'BOARDRESULT' + randomUUID()
  const title = 'Board message ' + marker.slice(-8)
  // Only base64 and a generated marker enter the terminal's shell syntax.
  const args = [
    'orchestration',
    'send',
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
  const payload = Buffer.from(JSON.stringify(args)).toString('base64')
  const command = `node -e 'const a=JSON.parse(Buffer.from(process.argv[1],"base64"));const r=require("node:child_process").spawnSync("orca",a,{stdio:"inherit"});console.log("\\n"+process.argv[2]+(r.status??1))' ${payload} ${marker}`
  let handle = ''
  try {
    const created = await terminal(['create', '--worktree', 'path:' + home, '--title', title, '--command', command])
    handle = str(obj(created.terminal), 'handle')
    if (!handle) throw Error('Missing terminal handle')
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const result = await terminal(['read', '--terminal', handle, '--limit', '80'])
      const output = rows(obj(result.terminal).tail).filter((s): s is string => typeof s === 'string')
      const status = output.find((line) => line.startsWith(marker) && /^\d+$/.test(line.slice(marker.length)))
      if (status) {
        if (status !== marker + '0') throw Error(output.slice(-12).join('\n'))
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw Error('Bot message timed out')
  } catch (error) {
    log(String(error))
    return false
  } finally {
    if (handle) await terminal(['close', '--terminal', handle]).catch((error) => log(String(error)))
  }
}
