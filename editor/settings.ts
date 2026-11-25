import { mergeMethods, methodLabels, type MergeMethod, type MergePreferences } from '../src/core/merge'
import { button, el, external, notice } from './dom'
import { icon } from './lanes'
import { popover } from './popover'
export async function readMergeSettings(demo: boolean) {
  const key = demo ? 'demo-merge-preferences' : 'merge-preferences'
  const state = await orca.storage.get(key)
  const prefs: MergePreferences = { mergeMethod: 'squash', askBeforeMerging: true }
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    prefs.mergeMethod = mergeMethods.find((m) => m === state.mergeMethod) ?? prefs.mergeMethod
    prefs.askBeforeMerging = state.askBeforeMerging !== false
  }
  return {
    prefs,
    save: () => {
      void orca.storage.set(key, prefs).catch(notice)
    },
  }
}
export function settings(saved: MergePreferences, update: () => void) {
  let menu: ReturnType<typeof popover> | undefined
  const gear = button(
    '',
    () => {
      if (menu?.node.isConnected) return menu.close(true)
      menu = popover(gear)
      menu.node.classList.add('settings')
      function row(name: string, hint: string, control: HTMLElement) {
        const label = el('label', '', 'set-row'),
          text = el('span', '', 'set-text')
        text.append(el('span', name), el('small', hint))
        label.append(text, control)
        return label
      }
      const select = el('select')
      for (const m of mergeMethods) select.add(new Option(methodLabels[m], m, false, m === saved.mergeMethod))
      select.onchange = () => {
        saved.mergeMethod = select.value as MergeMethod
        update()
      }
      const ask = el('input', '', 'switch')
      ask.type = 'checkbox'
      ask.checked = saved.askBeforeMerging
      ask.onchange = () => {
        saved.askBeforeMerging = ask.checked
        update()
      }
      const credit = external('Who created this?', 'https://github.com/guilatrova')
      credit.className = 'credit'
      menu.node.append(
        el('div', 'Settings', 'set-title'),
        el('div', 'Merging', 'mlabel'),
        row('Merge method', 'Preselected in the merge dialog.', select),
        row(
          'Ask before merging',
          'Off: clean pull requests merge in one step. Warnings and conflicts always ask.',
          ask,
        ),
        el('hr'),
        credit,
      )
      menu.position(false)
    },
    'ico',
  )
  gear.setAttribute('aria-label', 'Settings')
  gear.append(
    icon(
      'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-2 1.2l-.3 2h-4l-.3-2a7.6 7.6 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.7 7.7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7.6 7.6 0 0 1 2-1.2l.3-2h4l.3 2a7.6 7.6 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.7 7.7 0 0 1 0 3z',
    ),
  )
  return gear
}
