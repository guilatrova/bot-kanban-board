import { backoffDelay, maxBackoff, retryLabel } from '../core/backoff'
import type { Failure } from '../core/model'

export function retry(failure: Failure, consecutive: number, now: number) {
  const limited =
    failure.rateLimited === true ||
    failure.status === 429 ||
    (failure.status === 403 && /rate limit/i.test(failure.message))
  const delay = limited ? Math.max(1000, (failure.resetAt ?? now + maxBackoff) - now) : backoffDelay(consecutive)
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
    : retryLabel(delay)
  return { at, limited, message: reason + '. Trying again ' + when + '.' }
}
