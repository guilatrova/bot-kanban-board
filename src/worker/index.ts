import { measure } from './metrics'
import { dedupe, inFlight } from './dedupe'
import { watchItems } from './refresh-items'
import { invalidateOrca } from './sources/orca'
import { configureCliCache } from './cli'
import { serveFiles } from './pr-files'
import { boardStatus } from './status'
import { failureLog } from './failure-log'
import { readBoardPr, readFailureToLog, refreshFailure } from './read-board-pr'
import { mergePreflight } from './merge-preflight'
import { savedBoard } from './saved-board'
import { serveSnapshots } from './snapshot'
import { retry } from './polling'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Snapshot, Progress } from '../protocol'
import { prKey, type Failure } from '../core/model'
import { refreshItemData } from './refresh-items'
import { assessMerge, mergedToday, type MergedPr } from '../core/merge'
import { github, mergePr, closePr } from './sources/github'
import { registerBoardCommands } from './board-file'
import { sendBotMessage } from './bot-message'
import { avatars, serveAvatars } from './avatars'
import { notifications } from './bells'
import { jump } from './jump'
import { demoBoard, demoMerge } from '../demo'
export default async function activate(host: OrcaWorkerApi) {
  const { write, logged, loggedStorage } = failureLog(undefined, (message) => host.log(message))
  const { worker: orca, refresh: measuredRefresh } = measure(
    host,
    (step, fields) => void write({ step, fields, error: null }),
  )
  const readSettings = () => dedupe('settings', () => orca.settings.get())
  let settings = await readSettings()
  const demo = settings.demo === true
  orca.settings.onDidChange(() => {
    void readSettings()
      .then((value) => {
        settings = value
      })
      .catch((error) => orca.log(String(error)))
  })

  const data: Snapshot = demo
    ? demoBoard()
    : {
        sources: { orca: { status: 'stale', at: 0 }, github: { status: 'stale', at: 0 } },
        computers: [],
        prs: [],
        repos: {},
        merged: [],
        banner: null,
        total: 0,
        itemsAt: 0,
        prsAt: 0,
        error: null,
        focus: false,
      }
  const report = (error: unknown) => {
    orca.log(String(error))
    void write({ step: 'plugin', error })
  }
  const storage = loggedStorage(orca)
  configureCliCache(storage, report)
  const saved = savedBoard(storage, data, report)
  if (!demo) await Promise.all([saved.load('orca'), saved.load('github')])
  const status = await boardStatus(orca, data, demo, report)
  const landed = new Map<string, MergedPr>()
  function removeOpen(key: string) {
    const before = data.prs.length
    data.prs = data.prs.filter((p) => prKey(p) !== key)
    data.total = Math.max(0, data.total - (before - data.prs.length))
  }
  function recordMerged(row: MergedPr) {
    const key = prKey(row)
    removeOpen(key)
    if (mergedToday([row]).length) {
      landed.set(key, row)
      data.merged = mergedToday([row, ...data.merged.filter((p) => prKey(p) !== key)])
    }
    publish()
  }
  const closingPrs = new Set<string>()
  const busy = (key: string) => closingPrs.has(key) || data.running?.includes(key)
  const path = async (key: string) => String(settings[key] || '')
  const avatar = avatars(storage, (error) => write({ step: 'avatar', error }))
  if (!demo) await avatar.clearOversized().catch(report)

  let postTimer: ReturnType<typeof setTimeout> | undefined
  function publish() {
    if (postTimer) return
    postTimer = setTimeout(() => {
      postTimer = undefined
      status()
      publishSnapshot()
    }, 250)
  }
  const evaluateBells = await notifications(orca, data, publish, storage)
  function refreshItems() {
    return dedupe('refresh-items', () =>
      measuredRefresh(() => refreshItemData(orca, data, path, saved, avatar, evaluateBells, publish)).catch((error) => {
        report(error)
        data.sources.orca = { ...data.sources.orca, status: 'failed' }
        publish()
      }),
    )
  }
  const visible = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined,
    failures = 0,
    retryAt = 0,
    limitedUntil = 0
  const prInterval = () => Math.max(10, Number(settings.prSeconds) || 90) * 1000
  async function planPoll() {
    clearTimeout(timer)
    if (visible.size && !demo)
      timer = setTimeout(() => void refreshPrs(), retryAt ? Math.max(1, retryAt - Date.now()) : prInterval())
  }
  const reportRefreshFailure = (error: unknown) => refreshFailure(error, report)
  function refreshPrs(): Promise<void | Failure> {
    if (limitedUntil > Date.now()) return planPoll().catch(reportRefreshFailure)

    const previousPrs = data.sources.github
    return dedupe('refresh-prs', () =>
      measuredRefresh(async () => {
        const result = await github(await path('ghPath'), new Date())
        const search = result.ok ? result.value.merged : result
        if (result.ok && search.ok) {
          for (const [key, row] of landed) if (!mergedToday([row]).length) landed.delete(key)
          data.prs = result.value.prs.filter((pr) => !landed.has(prKey(pr)))
          data.repos = result.value.repos
          data.merged = mergedToday([...landed.values(), ...search.value.filter((pr) => !landed.has(prKey(pr)))])
          data.total = result.value.total - (result.value.prs.length - data.prs.length)
          data.login = result.value.login
          data.syncedAt = result.value.syncedAt
          data.allOpenLoaded = result.value.allOpenLoaded
          data.prsAt = Date.now()
          data.sources.github = { status: 'fresh', at: data.prsAt }
          data.error = null
          publish()
          await saved.save('github')
          await pruneFiles().catch(report)
          await evaluateBells({ open: data.prs, merged: data.merged, complete: result.value.allOpenLoaded })
        }
        if (!search.ok) {
          data.error = search
          data.sources.github = { ...data.sources.github, status: 'failed' }
          const next = retry(search, ++failures, Date.now())
          retryAt = next.at
          limitedUntil = next.limited ? retryAt : 0
          data.banner = next.message
        } else {
          data.banner = null
          failures = 0
          retryAt = 0
          limitedUntil = 0
        }
        publish()
      })
        .catch((error) => {
          if (data.sources.github === previousPrs) data.sources.github = { ...data.sources.github, status: 'failed' }
          publish()
          throw error
        })
        .finally(planPoll)
        .catch(reportRefreshFailure),
    )
  }
  async function visibilityChanged(id: string, shown: boolean) {
    if (shown) {
      const first = !visible.size
      visible.add(id)
      if (!demo && first && (!data.itemsAt || data.sources.orca.status === 'stale')) void refreshItems()
      if (!demo && first && limitedUntil <= Date.now()) await refreshPrs()
      else if (!inFlight('refresh-prs')) await planPoll()
    } else {
      visible.delete(id)
      if (!visible.size) clearTimeout(timer)
    }
  }
  const publishSnapshot = serveSnapshots(
    orca,
    data,
    async (id, shown) => {
      if (shown && !demo) {
        visible.add(id)
        if (!data.prsAt && !data.itemsAt) {
          await Promise.all([refreshPrs(), refreshItems()])
          return
        }
        if (visible.size === 1) {
          if (!data.itemsAt || data.sources.orca.status === 'stale') void refreshItems()
          if (!data.prsAt || data.sources.github.status === 'stale' || Date.now() - data.prsAt >= prInterval())
            void refreshPrs()
          else void planPoll()
        }
      }
    },
    visibilityChanged,
  )
  orca.panels.handle(
    'pr.read',
    logged(
      'PR read',
      async (input) =>
        readBoardPr(await path('ghPath'), input, data, demo, async () => publish(), recordMerged, removeOpen),
      readFailureToLog,
    ),
  )
  orca.panels.handle('board.refresh', async () => {
    if (demo) publish()
    else {
      await inFlight('refresh-items')
      invalidateOrca('all')
      await Promise.all([refreshItems(), refreshPrs()])
    }
    return null
  })
  serveAvatars(
    orca,
    avatar,
    () => (demo ? [] : data.computers),
    () => path('orcaPath'),
  )
  orca.panels.handle(
    'bot.tell',
    async (input) =>
      demo || sendBotMessage(await path('orcaPath'), data.computers, input, (message) => orca.log(message)),
  )
  orca.panels.handle('board.jump', async (input) =>
    demo ? 'Demo chat selected.' : jump(orca, data.computers, await path('orcaPath'), input),
  )
  async function reconcile(input: { repo: string; number: number }) {
    await inFlight('refresh-prs')
    const result = await readBoardPr(
      await path('ghPath'),
      { ...input, prOnly: true },
      data,
      false,
      async () => publish(),
      recordMerged,
      removeOpen,
    )
    if (!result.ok) report(result)
    await saved.save('github')
    await pruneFiles().catch(report)
  }
  orca.panels.handle(
    'pr.close',
    logged('close', async (input) => {
      const key = prKey(input)
      const pr = data.prs.find((p) => prKey(p) === key)
      if (demo || !pr || busy(key) || data.error)
        return {
          ok: false as const,
          command: 'Close PR',
          message: demo ? 'Demo data is read-only.' : 'Pull request unavailable.',
          next: 'Refresh the board.',
        }
      closingPrs.add(key)
      try {
        const result = await closePr(await path('ghPath'), pr)
        if (result.ok) {
          removeOpen(key)
          publish()
        }
        return result
      } finally {
        closingPrs.delete(key)
        void reconcile(input).catch(report)
      }
    }),
  )
  orca.panels.handle(
    'pr.merge',
    logged('preflight', async (input, setStep) => {
      const key = prKey(input),
        pr = data.prs.find((p) => prKey(p) === key),
        repo = data.repos[input.repo]
      if (
        !pr ||
        !input.sha ||
        input.updated !== pr.updated ||
        input.sha !== pr.sha ||
        !repo?.ok ||
        data.error ||
        busy(key)
      )
        return {
          ok: false as const,
          command: 'Merge',
          message: 'Pull request unavailable, changed or already merging.',
          next: 'Refresh the board and reopen the confirmation.',
        }
      data.running = [...(data.running ?? []), key]
      publish()
      try {
        let current = pr
        if (!demo && !input.bulk) {
          const live = await mergePreflight(await path('ghPath'), input, data, recordMerged, removeOpen, publish)
          if (!live.ok) return live
          current = live.value
        }
        const assessment = assessMerge(current, repo.value)
        if (!assessment.canMerge || !assessment.methods.includes(input.method))
          return {
            ok: false as const,
            command: 'Merge',
            message: assessment.blockers.join(' ') || 'Method unavailable.',
            next: 'Refresh and check the repository settings.',
          }
        const progress = (e: Progress) => {
          setStep('merge')
          orca.panels.post('merge.progress', e)
        }
        const ready = () => {
          current.draft = false
          publish()
        }
        const result = demo
          ? await demoMerge(current, progress, ready, false)
          : await mergePr(await path('ghPath'), current, input, progress, ready)
        if (result.ok) recordMerged({ ...current, mergedAt: new Date().toISOString() })
        return result
      } finally {
        data.running = data.running?.filter((k) => k !== key)
        publish()
        if (!demo) void reconcile(input).catch(report)
      }
    }),
  )
  const pruneFiles = serveFiles(orca, storage, data, path, logged)
  registerBoardCommands(orca, async () => (demo ? null : await path('orcaPath')))
  if (demo) return
  watchItems(
    orca,
    data,
    () => Boolean(visible.size),
    () => Number(settings.itemsSeconds) || 60,
    async (kind, environment, bot) => {
      await inFlight('refresh-items')
      invalidateOrca(kind, environment, bot)
      await refreshItems()
    },
    report,
  )
}
