import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { mergeRuntimeConfig } from '../lib/runtime-config'
import { edgeTtsPatch } from '../lib/tts-config'
import { defaultOpenCodeModel } from '../workflow/ai'

async function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) {
    throw new Error('Usage: pnpm podcast:configure <existing-config.json> <output.json>')
  }
  const body = JSON.parse(await readFile(input, 'utf8'))
  const current = body.draft || body
  const language = current.locale.language.startsWith('en') ? 'en-US' : 'zh-CN'
  const config = mergeRuntimeConfig(current, {
    ai: { provider: 'opencode', model: defaultOpenCodeModel },
    tts: edgeTtsPatch(language, current.hosts),
    test: { workflowTestStep: '', workflowTestInput: '', workflowTestInstructions: '', workflowTtsInput: '' },
    meta: { note: 'OpenCode Go DeepSeek Flash + native Edge TTS voices' },
  })
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`)
  console.info(`Prepared local config: ${resolve(output)}`)
  console.info({ ai: config.ai, language, voices: config.tts.voices })
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
