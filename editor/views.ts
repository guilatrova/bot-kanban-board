import { getStorage } from './storage'
import { allView, type View } from '../src/core/board'
import { button } from './dom'
import { panel, ask } from './controls'

import { storedViews } from '../src/core/views'
type Saved = Awaited<ReturnType<typeof storedViews>>
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
  const needs = button('Needs me only', () => {
    saved.current = { ...saved.current, name: '', needsMeOnly: !saved.current.needsMeOnly }
    update()
  })
  return {
    trigger,
    needs,
    sync() {
      trigger.textContent = 'View · ' + (saved.current.name || 'Current filters')
      needs.setAttribute('aria-pressed', String(saved.current.needsMeOnly))
    },
  }
}

export function readViews(
  demo: boolean,
  roster: () => Promise<{ name: string; computer: string }[]>,
  initial?: import('../src/protocol').Preferences,
) {
  return storedViews(initial ? { get: async (key) => initial[key] } : { get: getStorage }, demo, roster)
}
