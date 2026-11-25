import { el, external } from './dom'
import { prKey, type FileChange, type MappedPr } from '../src/core/model'
export async function showFiles(parent: HTMLElement, pr: MappedPr) {
  parent.textContent = 'Reading changed files…'
  try {
    let json = ''
    for (;;) {
      const result = await orca.plugin.request(
        'pr.files',
        { key: prKey(pr), updated: pr.updated, offset: json.length },
        { timeoutMs: 60000 },
      )
      if (!result.ok) throw Error([result.command, result.message, result.next].join(' · '))
      json += result.value.data
      if (result.value.end) break
    }
    const files = JSON.parse(json) as FileChange[]
    parent.replaceChildren()
    if (files.length < pr.files)
      parent.append(
        el('p', files.length + ' of ' + pr.files + ' files shown'),
        external('Files on GitHub', pr.url + '/files'),
      )
    for (const file of files) {
      const details = el('details')
      details.append(el('summary', file.filename + '   +' + file.additions + ' −' + file.deletions))
      details.ontoggle = () => {
        if (!details.open || details.children.length > 1) return
        if (!file.patch) {
          details.append(
            el('p', 'Patch unavailable for this binary or large file.'),
            external('View file on GitHub', file.url),
          )
          return
        }
        const pre = el('pre')
        for (const line of file.patch.split('\n'))
          pre.append(el('div', line || ' ', line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''))
        details.append(pre)
      }
      parent.append(details)
    }
  } catch (e) {
    parent.replaceChildren(el('p', String(e)), external('Files on GitHub', pr.url + '/files'))
  }
}
