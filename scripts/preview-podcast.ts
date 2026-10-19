import type { AiEnv } from '../workflow/ai'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseEnv } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { runtimeConfigBundleSchema } from '../lib/schemas/admin'
import { getTemplateVariables, renderPromptTemplates } from '../lib/template'
import { createResponseText, getPrimaryModel } from '../workflow/ai'
import { buildRuntimeTtsSettings, getSpeakerMarkers, parseConversationLines } from '../workflow/dialogue'
import { buildPodcastStoryInput, createEditorialArticle, linkArticleHeadings } from '../workflow/editorial-input'
import { getRecommendedTitle, parseTitleGenerationResult, titleGenerationSchema } from '../workflow/title'
import synthesize from '../workflow/tts'

interface SourceArticle { source?: string, title: string, link: string, content: string, publishedAt?: string }

function ffmpeg(args: string[]) {
  if (!ffmpegPath) {
    throw new Error('FFmpeg is unavailable. Run pnpm rebuild ffmpeg-static.')
  }
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`FFmpeg failed: ${result.error?.message || result.stderr}`)
  }
}

async function main() {
  const [configFile, sourceFile, outputDir, workerUrl, themeBaseUrl] = process.argv.slice(2)
  if (!configFile || !sourceFile || !outputDir) {
    throw new Error('Usage: pnpm podcast:preview <config.json> <articles.json> <output-dir> [local-tts-worker-url] [theme-worker-base-url]')
  }
  // Never copy environment variables or credentials to the output directory.
  const fileEnv = parseEnv(await readFile('worker/.env.local', 'utf8'))
  const env: AiEnv & Record<string, string | undefined> = { ...fileEnv, ...process.env }
  const config = runtimeConfigBundleSchema.parse(JSON.parse(await readFile(configFile, 'utf8')))
  if (config.ai.provider !== 'opencode' || config.tts.provider !== 'edge') {
    throw new Error('Preview expects an OpenCode + Edge config. Run podcast:configure first.')
  }
  const runtimeAi = { ...config.ai, sessionId: crypto.randomUUID() }
  const model = getPrimaryModel(env, 'opencode', runtimeAi)
  const prompts = renderPromptTemplates(config.prompts, getTemplateVariables(config))
  const settings = buildRuntimeTtsSettings(config)
  const articles: SourceArticle[] = JSON.parse(await readFile(sourceFile, 'utf8'))
  if (!articles.length || articles.some(article => !article.title || !article.content || !article.link)) {
    throw new Error('articles.json must contain { title, link, content } articles')
  }
  const output = resolve(outputDir)
  await mkdir(output, { recursive: true })
  const ask = async (instructions: string, input: string, schema?: object) => {
    const response = await createResponseText({
      env,
      runtimeAi,
      model,
      instructions,
      input,
      maxOutputTokens: 8192,
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
    })
    return response.text
  }
  const stories = articles.map(article => ({ title: article.title, url: article.link, sourceName: article.source || new URL(article.link).hostname }))
  const materials = articles.map((article, index) => createEditorialArticle(stories[index], article.content))
  await writeFile(resolve(output, 'articles.json'), `${JSON.stringify(materials, null, 2)}\n`)
  const storyInput = buildPodcastStoryInput(materials)
  console.info('Writing dialogue')
  const dialogue = await ask(prompts.summarizePodcast, storyInput)
  await writeFile(resolve(output, 'dialogue.txt'), `${dialogue}\n`)
  const rawLines = dialogue.split('\n').map(line => line.trim()).filter(Boolean)
  const lines = parseConversationLines(rawLines, getSpeakerMarkers(config))
  if (lines.length !== rawLines.length || !lines.length) {
    throw new Error('Dialogue contains unrecognized lines; refusing to omit content from the audio')
  }
  if (config.locale.language.startsWith('en') && /[\u3400-\u9FFF]/u.test(dialogue)) {
    throw new Error('English dialogue contains Chinese characters')
  }
  for (const host of config.hosts) {
    if (!lines.some(line => line.speaker === host.speakerMarker)) {
      throw new Error(`Dialogue is missing host ${host.name}`)
    }
  }
  const titleResult = parseTitleGenerationResult(await ask(prompts.title, dialogue, titleGenerationSchema))
  if (!titleResult) {
    throw new Error('Title generation returned an invalid result')
  }
  const title = getRecommendedTitle(titleResult)
  const intro = await ask(prompts.intro, dialogue)
  const blog = linkArticleHeadings(await ask(prompts.summarizeBlog, JSON.stringify({ articles: materials.map(({ source, title }) => ({ source, title })), conversation: dialogue })), stories)
  await writeFile(resolve(output, 'show-notes.md'), `# ${title}\n\n${intro}\n\n${blog}\n`)
  console.info(`Synthesizing ${lines.length} turns`)
  for (const [index, line] of lines.entries()) {
    const path = resolve(output, `turn-${String(index).padStart(3, '0')}.mp3`)
    let audio: Blob
    if (workerUrl) {
      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: line.text, speaker: line.speaker, options: settings }),
        signal: AbortSignal.timeout(100000),
      })
      if (!response.ok) {
        throw new Error(`Worker TTS failed: ${response.status} ${await response.text()}`)
      }
      audio = await response.blob()
    }
    else {
      audio = await synthesize(line.text, line.speaker, env as unknown as CloudflareEnv, settings)
    }
    if (!audio.size) {
      throw new Error(`Turn ${index} is empty`)
    }
    await writeFile(path, new Uint8Array(await audio.arrayBuffer()))
    console.info(`Turn ${index + 1}/${lines.length}: ${line.speaker}, ${audio.size} bytes`)
  }
  await writeFile(resolve(output, 'concat.txt'), lines.map((_, index) => `file 'turn-${String(index).padStart(3, '0')}.mp3'`).join('\n'))
  const speechPath = resolve(output, 'speech.mp3')
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', resolve(output, 'concat.txt'), '-map_metadata', '-1', '-metadata', 'comment=AI-generated podcast', '-c:a', 'libmp3lame', '-q:a', '5', speechPath])
  const finalPath = resolve(output, 'podcast.mp3')
  const music = config.tts.introMusic
  if (music.url) {
    const themeUrl = new URL(music.url, themeBaseUrl || env.PODCAST_WORKER_URL)
    const themeResponse = await fetch(themeUrl, { signal: AbortSignal.timeout(30000) })
    if (!themeResponse.ok) {
      throw new Error(`Intro music fetch failed: HTTP ${themeResponse.status}`)
    }
    const themePath = resolve(output, 'theme.mp3')
    await writeFile(themePath, new Uint8Array(await themeResponse.arrayBuffer()))
    const filter = `[0]afade=t=out:st=${music.fadeOutStart}:d=${music.fadeOutDuration}[intro];[1]adelay=${music.podcastDelay}|${music.podcastDelay}[podcast];[intro][podcast]amix=inputs=2:duration=longest`
    ffmpeg(['-i', themePath, '-i', speechPath, '-filter_complex', filter, '-map_metadata', '-1', '-metadata', 'comment=AI-generated podcast', '-c:a', 'libmp3lame', '-q:a', '5', finalPath])
  }
  else {
    await writeFile(finalPath, await readFile(speechPath))
  }
  // A full decode must succeed before marking the preview complete.
  ffmpeg(['-v', 'error', '-xerror', '-i', finalPath, '-f', 'null', '-'])
  const metadata = {
    title,
    podcastId: config.meta.podcastId,
    createdAt: new Date().toISOString(),
    ai: { ...config.ai, model },
    tts: { provider: config.tts.provider, language: settings.language, voices: config.tts.voices, speed: settings.speed },
    ttsRuntime: workerUrl ? 'local-cloudflare-worker' : 'node',
    sources: stories.map(({ title, url }) => ({ title, link: url })),
    dialogueTurns: lines.length,
    audioBytes: (await readFile(finalPath)).length,
    decodedSuccessfully: true,
  }
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  console.info(`Complete: ${finalPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
