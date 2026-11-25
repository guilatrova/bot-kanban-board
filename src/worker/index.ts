import type { OrcaWorkerApi } from 'orca/worker'
import type { Snapshot, Progress } from '../protocol'
import { prKey } from '../core/model'
import { computers } from './sources/orca'
import { assessMerge, mergedToday, type MergedPr } from '../core/merge'
import { github, files, mergePr, closePr, readPull } from './sources/github'
import { stackOrder } from '../core/stacks'
import { openBoard } from './board-file'
import { sendBotMessage } from './bot-message'
import { avatars } from './avatars'
import { notifications } from './bells'
import { jump } from './jump'
import { demoBoard, demoMerge } from '../demo'
import { parseActions, moveState } from '../core/actions'
export default async function activate(orca: OrcaWorkerApi) {
  const demo = (await orca.settings.get('demo')) === true

  const data: Snapshot = demo
    ? demoBoard()
    : {
        computers: [],
        prs: [],
        repos: {},
        merged: [],
        mergedError: null,
        total: 0,
        itemsAt: 0,
        prsAt: 0,
        error: null,
        focus: false,
      }
  const landed = new Map<string, MergedPr>()
  function recordMerged(row: MergedPr) {
    const key = prKey(row)
    if (data.prs.some((p) => prKey(p) === key)) data.total = Math.max(0, data.total - 1)
    data.prs = data.prs.filter((p) => prKey(p) !== key)
    if (mergedToday([row]).length) {
      landed.set(key, row)
      data.merged = mergedToday([row, ...data.merged.filter((p) => prKey(p) !== key)])
    }
    publish()
  }
  const closingPrs = new Set<string>()
  const busy = (key: string) => closingPrs.has(key) || data.running?.includes(key)
  const path = async (key: string) => String((await orca.settings.get(key)) || '')
  const avatar = avatars(orca.storage)
  const fileCache = new Map<string, string>()
  let postTimer: ReturnType<typeof setTimeout> | undefined
  function publish() {
    if (postTimer) return
    postTimer = setTimeout(() => {
      postTimer = undefined
      orca.panels.post('board.changed', null)
    }, 250)
  }
  const evaluateBells = await notifications(orca, data, publish)
  let itemJob: Promise<void> | null = null,
    prJob: Promise<void> | null = null
  function refreshItems() {
    return (itemJob ??= (async () => {
      const { moves } = parseActions(await orca.storage.get('actions'))
      const now = Date.now()
      const closing = new Set(
        Object.entries(moves)
          .filter(
            ([, move]) =>
              (move.target === 'done' || move.target === 'canceled') && moveState(move, undefined, now) === 'pending',
          )
          .map(([key]) => key),
      )
      for (const bell of data.bells ?? []) if (bell.kind === 'item') closing.add(bell.id)
      data.computers = await computers(
        await path('orcaPath'),
        closing,
        (computer) => {
          const position = data.computers.findIndex((previous) => previous.key === computer.key)
          if (position < 0) data.computers.push(computer)
          else data.computers[position] = computer
          data.itemsAt = Date.now()
          publish()
        },
        (message) => orca.log(message),
      )
      data.itemsAt = Date.now()
      publish()
      await evaluateBells({ items: data.computers.flatMap((c) => (c.source.ok ? c.source.value.items : [])) })
      await avatar.prune(data.computers)
      const n = data.computers
        .flatMap((c) => (c.source.ok ? c.source.value.items : []))
        .filter((i) => i.status === 'needs_you').length
      const unreachable = data.computers.filter((c) => !c.source.ok).length
      const hasCount = data.computers.some((c) => c.key !== 'discovery' && c.source.ok)
      const text = hasCount
        ? 'Needs you ' + n + (unreachable ? ' · ' + unreachable + ' unreachable' : '')
        : 'Needs you ?'
      await orca.host.call('statusBar.update', {
        id: 'needs-you',
        text,
        tone: hasCount ? (unreachable ? 'warning' : 'neutral') : 'danger',
      })
    })().finally(() => {
      itemJob = null
    }))
  }
  function refreshPrs() {
    return (prJob ??= (async () => {
      const result = await github(await path('ghPath'))
      if (result.ok) {
        for (const [key, row] of landed) if (!mergedToday([row]).length) landed.delete(key)
        data.prs = result.value.prs.filter((pr) => !landed.has(prKey(pr)))
        data.repos = result.value.repos
        const merged = result.value.merged
        data.mergedError = merged.ok ? null : merged
        const history = merged.ok ? merged.value : data.merged
        data.merged = mergedToday([...landed.values(), ...history.filter((pr) => !landed.has(prKey(pr)))])
        data.total = result.value.total
        data.prsAt = Date.now()
        data.error = null
        await evaluateBells({ open: data.prs, merged: data.merged, complete: result.value.allOpenLoaded && merged.ok })
        const valid = new Set(data.prs.map((p) => prKey(p) + '@' + p.updated))
        for (const key of fileCache.keys()) if (!valid.has(key)) fileCache.delete(key)
      } else data.error = result
      publish()
    })().finally(() => {
      prJob = null
    }))
  }
  const refresh = () => Promise.all([refreshItems(), refreshPrs()])
  const snapshots = new Map<string, string>()
  orca.panels.handle('board.get', async ({ index, fresh }, context) => {
    const id = context.panel.id
    if (index === 0) {
      if (fresh && !demo) await refresh()
      snapshots.set(id, JSON.stringify({ ...data, focus: fresh === true }))
    }
    const json = snapshots.get(id)
    if (!json) throw Error('Snapshot expired. Refresh the board.')
    const count = Math.ceil(json.length / 32000)
    if (index + 1 >= count) snapshots.delete(id)
    return { index, count, data: json.slice(index * 32000, (index + 1) * 32000) }
  })
  orca.panels.handle('pr.read', async (input) => {
    const live = demo ? undefined : await readPull(await path('ghPath'), input)
    if (live?.closed) return { closed: true as const, merged: false as const }
    if (live?.merged || (demo && data.merged.some((p) => prKey(p) === prKey(input)))) {
      if (live?.merged) recordMerged(live.row)
      return { merged: true as const }
    }
    if (!demo) await refreshPrs()
    const pr = live?.pr ?? data.prs.find((p) => prKey(p) === prKey(input))
    const facts = data.error || data.repos[input.repo]
    if (!pr || !facts) throw Error('Pull request unavailable.')
    const ordered = stackOrder([pr, ...data.prs.filter((p) => prKey(p) !== prKey(input))])
    return { merged: false as const, pr: ordered.find((p) => prKey(p) === prKey(input))!, facts }
  })
  orca.panels.handle('board.refresh', async () => {
    if (demo) publish()
    else await refresh()
    return null
  })
  orca.panels.handle('avatar.get', async (input) => {
    if (demo) return null
    const c = data.computers.find((c) => input.computer === c.key)
    if (!c?.source.ok) return null
    const { bots, workspaces } = c.source.value
    const bot = bots.find((b) => b.name === input.bot)
    if (!bot) return null
    return avatar.get(
      c.key,
      input.bot,
      bot.home ?? workspaces.find((w) => w.bot === input.bot && w.home)?.home ?? null,
      input.offset,
      await path('orcaPath'),
    )
  })
  orca.panels.handle(
    'bot.tell',
    async (input) =>
      demo || sendBotMessage(await path('orcaPath'), data.computers, input, (message) => orca.log(message)),
  )
  orca.panels.handle('board.jump', async (input) =>
    demo ? 'Demo chat selected.' : jump(orca, data.computers, await path('orcaPath'), input),
  )
  orca.panels.handle('pr.close', async (input) => {
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
        data.prs = data.prs.filter((p) => prKey(p) !== key)
        data.total = Math.max(0, data.total - 1)
        publish()
      }
      return result
    } finally {
      closingPrs.delete(key)
      void (async () => {
        await prJob
        await refreshPrs()
      })().catch(report)
    }
  })
  orca.panels.handle('pr.merge', async (input) => {
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
    const assessment = assessMerge(pr, repo.value)
    if (!assessment.canMerge || !assessment.methods.includes(input.method))
      return {
        ok: false as const,
        command: 'Merge',
        message: assessment.blockers.join(' ') || 'Method unavailable.',
        next: 'Refresh and check the repository settings.',
      }
    data.running = [...(data.running ?? []), key]
    publish()
    try {
      const progress = (e: Progress) => orca.panels.post('merge.progress', e)
      const ready = () => {
        pr.draft = false
        publish()
      }
      const result = demo
        ? await demoMerge(pr, progress, ready, false)
        : await mergePr(await path('ghPath'), pr, input, progress, ready)
      if (result.ok) {
        const row = {
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          mergedAt: new Date().toISOString(),
        }
        recordMerged(row)
      }
      return result
    } finally {
      data.running = data.running?.filter((k) => k !== key)
      publish()
      if (!demo)
        void (async () => {
          await prJob
          await refreshPrs()
        })().catch(report)
    }
  })
  orca.panels.handle('pr.files', async (input) => {
    if (demo) return { ok: true as const, value: { data: '[]', end: true } }
    const pr = data.prs.find((p) => prKey(p) === input.key && p.updated === input.updated),
      key = input.key + '@' + input.updated
    if (!pr)
      return {
        ok: false as const,
        command: 'gh api pulls/files',
        message: 'The pull request changed.',
        next: 'Reopen its drawer.',
      }
    let json = fileCache.get(key)
    if (!json) {
      const result = await files(await path('ghPath'), pr)
      if (!result.ok) return result
      json = JSON.stringify(result.value)
      fileCache.set(key, json)
    }
    const end = input.offset + 32000
    return { ok: true as const, value: { data: json.slice(input.offset, end), end: end >= json.length } }
  })
  for (const id of ['bot-kanban-board.needs-you', 'bot-kanban-board.open'])
    orca.commands.register(id, async () => {
      try {
        await openBoard(orca, demo ? null : await path('orcaPath'))
        orca.panels.post('board.focus', null)
      } catch (error) {
        const body = String(error) + ' · Reopen Bot Kanban Board from the command palette.'
        await orca.host.call('statusBar.update', {
          id: 'needs-you',
          text: 'Board unavailable',
          tooltip: body,
          tone: 'danger',
        })
        await orca.host.call('notifications.show', { title: 'Could not open Bot Kanban Board', body })
      }
    })
  if (demo) return
  let debounce: ReturnType<typeof setTimeout> | undefined
  const report = (e: unknown) => orca.log(String(e))
  orca.events.on('agent.status.changed', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void refreshItems().catch(report), 300)
  })
  function schedule(key: string, defaultValue: number, job: () => Promise<void>) {
    async function tick() {
      try {
        await job()
      } catch (e) {
        report(e)
      } finally {
        const seconds = Number(await orca.settings.get(key)) || defaultValue
        setTimeout(() => void tick().catch(report), Math.max(10, seconds) * 1000)
      }
    }
    void tick().catch(report)
  }
  schedule('itemsSeconds', 30, refreshItems)
  schedule('prSeconds', 90, refreshPrs)
}
