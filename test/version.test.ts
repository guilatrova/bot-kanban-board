import { expect, it } from 'vitest'
import { pluginVersion } from '../editor/settings'
import manifest from '../orca-plugin.json'
import pkg from '../package.json'

it('shows the package and Orca manifest release version in Settings', () => {
  expect(pkg.version).toBe(pluginVersion)
  expect(manifest.version).toBe(pluginVersion)
})
