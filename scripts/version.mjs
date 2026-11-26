import { readFile, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'

const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
await writeFile(new URL('../src/version.ts', import.meta.url), `export const version = '${manifest.version}'\n`)
