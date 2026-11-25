import type { OrcaWorkerApi } from 'orca/worker'
import type { Snapshot } from '../protocol'
import { prKey } from '../core/model'
import { computers } from './sources/orca'
import { manualBotNotification, assessMerge, mergedToday, type MergedPr } from '../core/merge'
import { github, files, mergePr, closePr } from './sources/github'
import { openBoard } from './board-file'
import { avatars } from './avatars'
import { notifications } from './bells'
import { jump } from './jump'
import { demoBoard } from '../demo'
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
  const merging = new Set<string>()
  const path = async (key: string) => String((await orca.settings.get(key)) || '')
  const avatar = avatars(orca.storage)
  const fileCache = new Map<string, string>()
  function publish(panel?: string) {
    const json = JSON.stringify({ ...data, focus: Boolean(panel) && data.focus }),
      size = 32000,
      count = Math.ceil(json.length / size)
    for (let i = 0; i < count; i++)
      orca.panels.post(
        'board.changed',
        { index: i, count, data: json.slice(i * size, (i + 1) * size) },
        panel ? { panel } : undefined,
      )
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
      data.computers = await computers(await path('orcaPath'), closing, (computer) => {
        const position = data.computers.findIndex((previous) => previous.key === computer.key)
        if (position < 0) data.computers.push(computer)
        else data.computers[position] = computer
        data.itemsAt = Date.now()
        publish()
      })
      data.itemsAt = Date.now()
      publish()
      await evaluateBells(
        data.computers.flatMap((c) => (c.source.ok ? c.source.value.items : [])),
        [],
      )
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
        await evaluateBells([], data.prs)
        const valid = new Set(data.prs.map((p) => prKey(p) + '@' + p.updated))
        for (const key of fileCache.keys()) if (!valid.has(key)) fileCache.delete(key)
      } else data.error = result
      publish()
    })().finally(() => {
      prJob = null
    }))
  }
  const refresh = () => Promise.all([refreshItems(), refreshPrs()])
  orca.panels.handle('board.get', async (_, context) => {
    if (!demo && (itemJob || !data.itemsAt)) await refreshItems()
    publish(context.panel.id)
    data.focus = false
    return null
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
  orca.panels.handle('board.jump', async (input) =>
    demo ? 'Demo chat selected.' : jump(orca, data.computers, await path('orcaPath'), input),
  )
  orca.panels.handle('pr.close', async (input) => {
    const key = prKey(input)
    const pr = data.prs.find((p) => prKey(p) === key)
    if (demo || !pr || merging.has(key) || data.error)
      return {
        ok: false as const,
        command: 'Close PR',
        message: demo ? 'Demo data is read-only.' : 'Pull request unavailable.',
        next: 'Refresh the board.',
      }
    merging.add(key)
    try {
      const result = await closePr(await path('ghPath'), pr)
      if (result.ok) {
        data.prs = data.prs.filter((p) => prKey(p) !== key)
        data.total = Math.max(0, data.total - 1)
        publish()
      }
      return result
    } finally {
      merging.delete(key)
      void (async () => {
        await prJob
        await refreshPrs()
      })().catch(report)
    }
  })
  orca.panels.handle('pr.merge', async (input, context) => {
    if (demo)
      return {
        ok: false as const,
        command: 'Demo',
        message: 'Demo data is read-only.',
        next: 'Close the confirmation.',
      }
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
      merging.has(key)
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
    merging.add(key)
    try {
      const result = await mergePr(
        await path('ghPath'),
        pr,
        input,
        (e) => orca.panels.post('merge.progress', e, { panel: context.panel.id }),
        () => {
          pr.draft = false
          publish()
        },
      )
      if (result.ok) {
        const row = {
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          mergedAt: new Date().toISOString(),
          notification: manualBotNotification,
        }
        landed.set(key, row)
        data.merged = [row, ...data.merged.filter((p) => prKey(p) !== key)]
        data.prs = data.prs.filter((p) => prKey(p) !== key)
        data.total = Math.max(0, data.total - 1)
        publish()
      }
      return result
    } finally {
      merging.delete(key)
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
  for (const focus of [false, true])
    orca.commands.register(focus ? 'bots-board.needs-you' : 'bots-board.open', async () => {
      data.focus = focus
      await openBoard(orca, demo ? null : await path('orcaPath'))
      if (focus) orca.panels.post('board.focus', null)
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
