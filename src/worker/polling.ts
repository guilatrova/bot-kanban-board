import type { Failure } from '../core/model'

export function retry(failure: Failure, consecutive: number, now: number) {
  const limited =
    (failure.status === 403 || failure.status === 429) &&
    (failure.status === 429 || failure.rateLimited || /rate limit/i.test(failure.message))
  const delay = limited
    ? Math.max(1000, (failure.resetAt ?? now + 360000) - now)
    : Math.min(360000, 90000 * 2 ** Math.min(2, consecutive - 1))
  const at = now + delay
  const reason = limited
    ? 'GitHub rate limit reached'
    : failure.status === 401 || /not logged (?:in|into)|gh auth login/i.test(failure.message)
      ? 'GitHub needs authentication. Run gh auth login'
      : failure.status
        ? 'GitHub is having trouble (HTTP ' + failure.status + ')'
        : /inside a bot session|Cannot find executable/.test(failure.message)
          ? failure.message.replace(/\.$/, '')
          : 'Can’t reach GitHub'
  const when = limited
    ? 'at ' + new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : delay === 90000
      ? 'in 90 seconds'
      : 'in ' + delay / 60000 + ' min'
  return { at, limited, message: reason + '. Trying again ' + when + '.' }
}
