import { onStorageWrite, trafficReport } from './storage'
import { panelRequest } from './panel-request'
import { backoffDelay, retryLabel } from '../src/core/backoff'
import { skeleton } from './loading'
import { readMergeSettings } from './settings'
import { readViews } from './views'
import { readActions } from './item-actions'
import { view } from './render'
import { notice, el, button, loadPictures } from './dom'
import { applyChanges } from '../src/core/snapshot-diff'
import { cached, persist } from './frame-cache'
import type { Preferences } from '../src/protocol'
import type { BoardReply, Snapshot, Version } from '../src/protocol'
async function start() {
  type Stored = Version & { snapshot: Snapshot; preferences: Preferences }
  const cacheKey = 'bot-board-v1'
  let stored = cached<Stored>(cacheKey)
  onStorageWrite((key, value) => {
    if (!stored || !(key in stored.preferences)) return
    stored.preferences[key] = value
    persist(cacheKey, stored)
  })
  const loading = skeleton(false)
  const state = el('div', '', 'first-error')
  state.setAttribute('role', 'alert')
  const reason = el('span')
  const again = button('Try again', () => run(true))
  state.append(reason, again)
  if (!stored) document.body.append(loading)
  const visibility = (visible: boolean) =>
    panelRequest('board.visibility', { visible, ...trafficReport() }, { timeoutMs: 120000 })
  let visibilityTimer: ReturnType<typeof setTimeout>
  document.addEventListener('visibilitychange', () => {
    clearTimeout(visibilityTimer)
    visibilityTimer = setTimeout(() => void visibility(!document.hidden).catch(notice), 100)
  })
  window.addEventListener('pagehide', () => {
    clearTimeout(visibilityTimer)
    void visibility(false).catch(notice)
  })
  let confirmed = false
  let board: ReturnType<typeof view> | undefined
  let drawn = false
  let latest: Snapshot
  const roster = async () => {
    return latest.computers.flatMap((c) => (c.source.ok ? c.source.value.bots : []))
  }
  async function read(fresh = false) {
    const chunks: string[] = []
    let reply: BoardReply
    for (let index = 0; ; index++) {
      const part = await panelRequest(
        'board.get',
        {
          ...trafficReport(),
          index,
          fresh,
          visible: !document.hidden,
          ...(stored ? { epoch: stored.epoch, revision: stored.revision } : {}),
        },
        { timeoutMs: 120000 },
      )
      if ('kind' in part) {
        reply = part
        break
      }
      chunks.push(part.data)
      if (index + 1 === part.count) {
        reply = JSON.parse(chunks.join('')) as BoardReply
        break
      }
    }
    const snapshot = reply.kind === 'full' ? reply.snapshot : applyChanges(stored!.snapshot, reply.changes)
    const preferencesChanged =
      !!stored && !!reply.preferences && JSON.stringify(stored.preferences) !== JSON.stringify(reply.preferences)
    stored = {
      epoch: reply.epoch,
      revision: reply.revision,
      snapshot,
      preferences: reply.preferences ?? stored!.preferences,
    }
    confirmed = true
    persist(cacheKey, stored)
    await draw(snapshot, preferencesChanged)
    if (fresh) board?.focus()
  }
  async function draw(data: Snapshot, preferencesChanged = false) {
    latest = data
    if (!data.demo) loadPictures(data.computers, stored!.epoch, confirmed)
    if (!board || preferencesChanged) {
      const [saved, actions, settings] = await Promise.all([
        readViews(Boolean(data.demo), roster, stored!.preferences),
        readActions(Boolean(data.demo), stored!.preferences),
        readMergeSettings(Boolean(data.demo), stored!.preferences),
      ])
      const collapsed = stored!.preferences.collapsed
      const folded = new Set<string>(
        Array.isArray(collapsed) ? collapsed.filter((k): k is string => typeof k === 'string') : ['waiting', 'closed'],
      )
      if (board) {
        Object.assign(board.saved, saved)
        Object.assign(board.prefs, settings.prefs)
        Object.assign(board.actions, actions.state)
        board.fold(folded)
      } else board = view(saved, settings, actions, folded)
    }
    board.draw(data)
    drawn = true
    loading.remove()
    state.remove()
  }
  let dirty = false,
    reading = false
  let readFailures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  function showError(message: string) {
    reason.textContent = message
    loading.remove()
    if (!state.isConnected) document.body.prepend(state)
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
      if (drawn) notice(error)
      else {
        const delay = backoffDelay(++readFailures)
        showError('Could not load the board. ' + String(error) + ' Trying again ' + retryLabel(delay) + '.')
        retryTimer = setTimeout(() => void run(true), delay)
      }
    } finally {
      reading = false
      again.disabled = false
    }
  }
  if (stored) await draw(stored.snapshot)
  orca.plugin.on('board.changed', (push) => {
    if (
      reading ||
      !stored ||
      stored.epoch !== push.epoch ||
      stored.revision !== push.baseRevision ||
      'resync' in push
    ) {
      void run()
      return
    }
    stored = { ...stored, revision: push.revision, snapshot: applyChanges(stored.snapshot, push.changes) }
    persist(cacheKey, stored)
    void draw(stored.snapshot).catch(notice)
  })
  orca.plugin.on('board.focus', () => board?.focus())
  await run(true)
}
try {
  await start()
} catch (error) {
  window.reportError(error)
}
