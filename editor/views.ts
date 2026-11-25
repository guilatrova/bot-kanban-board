import { allView, type View } from '../src/core/board'
import { button } from './dom'
import { panel, ask } from './controls'

type Saved = { version: 1; current: View; views: View[] }
export function views(saved: Saved, update: () => void) {
  const trigger = button('', () => {
    const dialog = panel('Views')
    function choose(v: View) {
      saved.current = { ...v }
      dialog.close()
      update()
    }
    for (const v of [allView, ...saved.views]) dialog.append(button(v.name || 'All activity', () => choose(v)))
    dialog.append(
      button('Save current as…', () =>
        ask('Save current view', '', (name) => {
          if (saved.views.some((v) => v.name === name)) throw Error('A view with this name already exists.')
          const view = { ...saved.current, name }
          saved.views.push(view)
          choose(view)
        }),
      ),
    )
    const index = saved.views.findIndex((v) => v.name === saved.current.name)
    if (index >= 0) {
      dialog.append(
        button('Rename', () =>
          ask('Rename view', saved.current.name, (name) => {
            if (saved.views.some((v, i) => v.name === name && i !== index))
              throw Error('A view with this name already exists.')
            const v = saved.views[index]!
            v.name = name
            choose(v)
          }),
        ),
        button('Delete view', () => {
          saved.views.splice(index, 1)
          choose(allView)
        }),
      )
    }
  })
  const repos = button('Repositories', () => {
    const dialog = panel('Repositories')
    const add = (label: string, key?: string) => {
      const active = key
        ? saved.current.repos !== 'all' && saved.current.repos.includes(key)
        : saved.current.repos === 'all'
      const btn = button(label, () => {
        const selected = new Set(saved.current.repos === 'all' ? [] : saved.current.repos)
        if (key && selected.has(key)) selected.delete(key)
        else if (key) selected.add(key)
        saved.current = { ...saved.current, name: '', repos: key && selected.size ? [...selected] : 'all' }
        update()
        dialog.close()
      })
      btn.setAttribute('aria-pressed', String(active))
      dialog.append(btn)
    }
    add('All repositories')
    for (const repo of options) add(repo, repo)
  })
  let options: string[] = []
  const needs = button('Needs me only', () => {
    saved.current = { ...saved.current, name: '', needsMeOnly: !saved.current.needsMeOnly }
    update()
  })
  return {
    trigger,
    repos,
    needs,
    sync(list: string[]) {
      options = [...new Set(list)].sort()
      trigger.textContent = 'View · ' + (saved.current.name || 'Current filters')
      needs.setAttribute('aria-pressed', String(saved.current.needsMeOnly))
      repos.textContent = saved.current.repos === 'all' ? 'Repositories' : saved.current.repos.join(', ')
    },
  }
}

export async function readViews(): Promise<Saved> {
  const state = await orca.storage.get('views')
  if (state && typeof state === 'object' && 'version' in state && state.version === 1) return state as Saved
  const old = await orca.storage.get('filter')
  return {
    version: 1,
    views: [],
    current: {
      ...allView,
      bots: Array.isArray(old) && old.length ? old.filter((k): k is string => typeof k === 'string') : 'all',
    },
  }
}
