import { mergeMethods, methodLabels, type MergeMethod, type MergePreferences } from '../src/core/merge'
import { botKey, type Computer } from '../src/core/model'
import { button, el, external, notice } from './dom'
import { icon } from './lanes'
import { popover } from './popover'
export async function readMergeSettings(demo: boolean) {
  const key = demo ? 'demo-merge-preferences' : 'merge-preferences'
  const state = await orca.storage.get(key)
  const prefs: MergePreferences = {
    mergeMethod: 'squash',
    askBeforeMerging: true,
    tellBot: false,
    botName: '',
    computer: 'local',
  }
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    prefs.tellBot = state.tellBot === true
    prefs.botName = typeof state.botName === 'string' ? state.botName : ''
    prefs.computer = typeof state.computer === 'string' ? state.computer : 'local'
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
export function settings(saved: MergePreferences, update: () => void, computers: () => Computer[]) {
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
      const tell = el('input', '', 'switch after-switch'),
        bots = el('select')
      tell.type = 'checkbox'
      tell.checked = saved.tellBot
      bots.add(new Option('Choose a bot', ''))
      for (const c of computers())
        if (c.source.ok)
          for (const b of c.source.value.bots) {
            bots.add(new Option(b.name + (c.key === 'local' ? '' : ' · ' + c.name), botKey(c.key, b.name)))
          }
      bots.value = botKey(saved.computer, saved.botName)
      if (bots.selectedIndex < 0) bots.selectedIndex = 0
      bots.disabled = !tell.checked
      bots.onchange = () => {
        const choice = bots.value ? (JSON.parse(bots.value) as [string, string]) : ['local', '']
        saved.computer = choice[0]!
        saved.botName = choice[1]!
        update()
      }
      tell.onchange = () => {
        saved.tellBot = tell.checked
        bots.disabled = !tell.checked
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
        el('div', 'After a merge', 'mlabel'),
        row('Tell a bot', 'One Orca message per merge, or one for a whole batch', tell),
        row('Which bot', '', bots),
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
