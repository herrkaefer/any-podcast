import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { edgeTtsPatch } from '../lib/tts-config'
import synthesize from '../workflow/tts'

async function main() {
  const output = resolve('tmp/edge-tts-smoke')
  const workerUrl = process.argv[2]
  await mkdir(output, { recursive: true })
  for (const language of ['zh-CN', 'en-US']) {
    const patch = edgeTtsPatch(language, [{ id: 'host1' }, { id: 'host2' }])
    for (const [speaker, voice] of Object.entries(patch.voices)) {
      const text = language === 'zh-CN'
        ? '欢迎收听谱系之间。今天我们聊聊日常环境中的声音，以及人与人之间不同的感受。理解一个人的需要，可以从认真听他说话开始。'
        : 'Welcome to Living on the Spectrum. Today we are talking about everyday sounds and the different ways people experience them. Understanding someone can start with listening to what they need.'
      let audio: Blob
      if (workerUrl) {
        const response = await fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speaker, options: { ...patch, voicesBySpeaker: patch.voices } }),
          signal: AbortSignal.timeout(100000),
        })
        if (!response.ok) {
          throw new Error(`Worker TTS failed: ${response.status} ${await response.text()}`)
        }
        audio = await response.blob()
      }
      else {
        audio = await synthesize(text, speaker, {} as CloudflareEnv, { ...patch, voicesBySpeaker: patch.voices })
      }
      const path = resolve(output, `${workerUrl ? 'worker' : 'node'}-${voice}.mp3`)
      await writeFile(path, new Uint8Array(await audio.arrayBuffer()))
      console.info({ voice, bytes: audio.size, path })
    }
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
