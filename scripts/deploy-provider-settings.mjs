import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseEnv } from 'node:util'

const local = parseEnv(await readFile('worker/.env.local', 'utf8'))
const env = { ...local, ...process.env }
if (!env.OPENCODE_API_KEY?.trim()) {
  throw new Error('Configure OPENCODE_API_KEY in worker/.env.local before deploying')
}
const settings = {
  OPENCODE_API_KEY: env.OPENCODE_API_KEY.trim(),
  // An empty override restores the model selected in Admin.
  OPENCODE_MODEL: env.OPENCODE_MODEL?.trim() || '',
}
const targets = process.argv.slice(2)
for (const target of targets.length ? targets : ['cn', 'en']) {
  if (!['cn', 'en'].includes(target)) {
    throw new Error(`Unknown podcast target: ${target}`)
  }
  const result = spawnSync(process.execPath, [
    resolve('node_modules/wrangler/bin/wrangler.js'),
    'secret',
    'bulk',
    '--config',
    `worker/wrangler.spectrum-${target}.jsonc`,
  ], { input: JSON.stringify(settings), encoding: 'utf8' })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error || result.status !== 0) {
    throw new Error(`Provider settings deployment failed for ${target}: ${result.error?.message || result.status}`)
  }
  console.info(`OpenCode settings deployed for ${target}; model: ${settings.OPENCODE_MODEL || 'Admin setting'}`)
}
