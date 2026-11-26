import type { Failure } from './model'

export type MergeStep = 'preflight' | 'merge' | 'PR read'
export interface MergeAttemptError {
  n: number
  at: Date
  step: MergeStep
  status?: number
  short: string
  full: string
}
export type AttemptFailure = Omit<MergeAttemptError, 'n' | 'at'>

function timeout(step: MergeStep, seconds: number): AttemptFailure {
  return {
    step,
    short: 'timeout after ' + seconds + 's',
    full: 'GitHub did not answer within ' + seconds + ' seconds.',
  }
}
function pluginError(step: MergeStep): AttemptFailure {
  return {
    step,
    short: 'board plugin error',
    full: 'The board plugin refused the request. Try again; if it keeps failing, reload the board.',
  }
}
export function fromThrown(err: unknown, step: MergeStep, timeoutSeconds: number): AttemptFailure {
  const code = err && typeof err === 'object' && 'code' in err ? err.code : err
  return code === 'timeout' ? timeout(step, timeoutSeconds) : pluginError(step)
}
export function fromFailure(f: Failure, step: MergeStep): AttemptFailure {
  const full = f.detail ?? f.message
  const [first = '', ...rest] = full
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
  let short = f.message.trim().split(/\r?\n/)[0] ?? ''
  if (f.status) {
    if (/^Repository rule violations found|^Validation failed\b|\b(?:found|failed)[.:]?$/i.test(first)) {
      const violation = rest.find((line) => line && !/^https?:\/\//i.test(line))
      if (violation) short = violation.replace(/^[-*]\s+/, '').replace(/\.$/, '')
    }
    return { step, status: f.status, short, full }
  }
  if (f.kind === 'timeout' && f.timeoutSeconds !== undefined) return timeout(step, f.timeoutSeconds)
  if (f.kind === 'network')
    return { step, short: 'network error', full: 'Could not reach GitHub. Check the internet connection.' }
  if (
    /^[A-Z][A-Z_0-9]*$|\b[A-Z]+_[A-Z_]+\b|\bE[A-Z]{2,}\b|\bpr\.(read|merge)\b|^(?:Command failed|TypeError:|Error:|SyntaxError:|spawn )/m.test(
      full,
    )
  )
    return pluginError(step)
  return { step, short, full }
}
export function attemptLabel(a: AttemptFailure) {
  return a.status ? a.status + ' · ' + a.short : a.short
}
export function attemptMeta(a: MergeAttemptError) {
  const time = [a.at.getHours(), a.at.getMinutes(), a.at.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
  return 'Attempt ' + a.n + ' · ' + time + ' · ' + a.step + (a.status ? ' · HTTP ' + a.status : '')
}
export function attemptsText(list: MergeAttemptError[]) {
  return list.map((a) => attemptMeta(a) + '\n' + a.full).join('\n\n')
}
