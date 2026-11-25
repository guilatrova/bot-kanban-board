import type { OrcaWorkerApi } from 'orca/worker'
import { firedBells, type Bell } from '../core/bells'
import type { Item, PullRequest } from '../core/model'
import type { Snapshot } from '../protocol'
export async function notifications(orca: OrcaWorkerApi, data: Snapshot, publish: () => void) {
  const key = data.demo ? 'demo-bells' : 'bells'
  const stored = await orca.storage.get(key)
  data.bells = Array.isArray(stored) ? (stored as Bell[]) : []
  data.notificationsOff = (await orca.storage.get(key + '-off')) === true
  let queue = Promise.resolve()
  function serialize(job: () => Promise<void>) {
    const next = queue.then(job)
    queue = next.catch((e) => orca.log(String(e)))
    return next
  }
  async function save(bells: Bell[]) {
    await orca.storage.set(key, bells)
    data.bells = bells
    publish()
  }
  orca.panels.handle('bell.set', async ({ bell, on }) => {
    await serialize(async () => {
      const bells = (data.bells ?? []).filter((b) => b.id !== bell.id)
      if (on) bells.push(bell)
      await save(bells)
    })
    return null
  })
  return (items: Item[], prs: PullRequest[]) =>
    serialize(async () => {
      for (const [id, title] of firedBells(data.bells ?? [], items, prs)) {
        const { delivered } = await orca.host.call('notifications.show', { title })
        data.notificationsOff = !delivered
        await orca.storage.set(key + '-off', !delivered)
        await save((data.bells ?? []).filter((b) => b.id !== id))
      }
    })
}
