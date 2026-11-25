import { backoffDelay, retryLabel } from '../src/core/backoff'
import { skeleton } from './loading'
import { readMergeSettings } from './settings'
import { readViews } from './views'
import { readActions } from './item-actions'
import { view } from './render'
import { notice, el, button } from './dom'
import type { Snapshot } from '../src/protocol'
async function start() {
  const demo = (await orca.settings.get('demo')) === true
  const settings = await readMergeSettings(demo)
  const loading = skeleton(settings.prefs.compact)
  const state = el('div', '', 'first-error')
  const reason = el('span')
  const again = button('Try again', () => run(true))
  state.append(reason, again)
  document.body.append(loading)
  const visibility = (shown: boolean, initial = false) =>
    orca.plugin.request('board.visibility', { shown, initial }, { timeoutMs: 120000 })
  document.addEventListener('visibilitychange', () => void visibility(!document.hidden).catch(notice))
  window.addEventListener('pagehide', () => void visibility(false).catch(notice))
  await visibility(!document.hidden, true)
  let board: Promise<ReturnType<typeof view>> | undefined
  let latest: Snapshot
  const roster = async () => {
    return latest.computers.flatMap((c) => (c.source.ok ? c.source.value.bots : []))
  }
  async function read(fresh = false) {
    const chunks: string[] = []
    for (let index = 0; ; index++) {
      const chunk = await orca.plugin.request('board.get', { index, fresh }, { timeoutMs: 120000 })
      chunks.push(chunk.data)
      if (index + 1 === chunk.count) break
    }
    const data = JSON.parse(chunks.join('')) as Snapshot
    latest = data
    if (!board && !data.prsAt) {
      if (data.banner) showError(data.banner)
      return
    }
    board ??= Promise.all([
      readViews(Boolean(data.demo), roster),
      settings,
      readActions(Boolean(data.demo)),
      orca.storage.get('collapsed'),
    ]).then(([saved, mergeSettings, actions, collapsed]) => {
      loading.remove()
      state.remove()
      return view(
        saved,
        mergeSettings,
        actions,
        new Set<string>(
          Array.isArray(collapsed)
            ? collapsed.filter((k): k is string => typeof k === 'string')
            : ['waiting', 'closed'],
        ),
      )
    })
    ;(await board).draw(data)
  }
  let dirty = false,
    reading = false
  let readFailures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  function showError(message: string) {
    reason.textContent = message
    loading.remove()
    if (!state.isConnected) document.body.append(state)
  }
  async function run(fresh = false) {
    if (reading) {
      dirty = true
      return
    }
    reading = true
    again.disabled = true
    clearTimeout(retryTimer)
    try {
      do {
        dirty = false
        await read(fresh)
        readFailures = 0
        fresh = false
      } while (dirty)
    } catch (error) {
      if (board) notice(error)
      else {
        const delay = backoffDelay(++readFailures)
        showError('Could not read the board. Trying again ' + retryLabel(delay) + '.')
        retryTimer = setTimeout(() => void run(true), delay)
      }
    } finally {
      reading = false
      again.disabled = false
    }
  }
  orca.plugin.on('board.changed', () => void run())
  orca.plugin.on('board.focus', () => void board?.then((b) => b.focus()))
  await run(true)
}
void start().catch(notice)
