#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_DIALOG = [
  '男：大家好，欢迎收听本期播客，我是 Host1。',
  '女：大家好，我是 Host2。',
  '男：今天我们用 MiniMax 做一次按句合成测试，并把所有分句音频拼接成完整文件。',
  '女：这个脚本会逐句调用 TTS 接口，还会做 60 RPM 的节流，避免触发限流。',
  '男：如果最终你能听到完整的连续语音，就说明链路是通的。',
  '女：好的，测试到这里结束。',
]

const DEFAULT_OUTPUT_DIR = 'tmp/minimax-tts-batch'
const DEFAULT_OUTPUT_FILE = 'final.mp3'
const DEFAULT_MAX_RPM = 60
const DEFAULT_RPM_BUFFER_MS = 150
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_MS = 1500

let lastRequestAt = 0

async function sleepMs(ms) {
  if (ms <= 0) {
    return
  }
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

function parseArgs(argv) {
  const options = {
    input: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    outputFile: DEFAULT_OUTPUT_FILE,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--input') {
      options.input = argv[i + 1] || ''
      i += 1
      continue
    }
    if (arg === '--output-dir') {
      options.outputDir = argv[i + 1] || DEFAULT_OUTPUT_DIR
      i += 1
      continue
    }
    if (arg === '--output-file') {
      options.outputFile = argv[i + 1] || DEFAULT_OUTPUT_FILE
      i += 1
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function printHelp() {
  console.info(`
Usage:
  node scripts/test-minimax-tts.mjs [--input <file>] [--output-dir <dir>] [--output-file <name>] [--dry-run]

Options:
  --input         Path to dialog text file. Format: one line per utterance, e.g. "男：你好。"
  --output-dir    Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --output-file   Merged audio file name (default: ${DEFAULT_OUTPUT_FILE})
  --dry-run       Parse and split only; do not call MiniMax API
`)
}

async function loadEnvFromLocal() {
  const candidates = [
    resolve(process.cwd(), 'worker/.env.local'),
    resolve(process.cwd(), '.env.local'),
  ]

  for (const envPath of candidates) {
    try {
      const content = await readFile(envPath, 'utf8')
      const entries = parseEnv(content)
      for (const [key, value] of entries) {
        if (process.env[key] === undefined) {
          process.env[key] = value
        }
      }
    }
    catch (error) {
      if (error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }
}

function parseEnv(content) {
  const result = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const index = line.indexOf('=')
    if (index <= 0) {
      continue
    }
    const key = line.slice(0, index).trim()
    const rawValue = line.slice(index + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')
    result.push([key, value])
  }
  return result
}

function parseDialogLines(rawText) {
  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    throw new Error('Dialog input is empty')
  }
  return lines
}

function splitSentences(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return []
  }

  const endMarks = new Set(['。', '！', '？', '；', '.', '!', '?', ';'])
  const segments = []
  let buffer = ''

  for (const char of normalized) {
    buffer += char
    if (endMarks.has(char)) {
      const sentence = buffer.trim()
      if (sentence) {
        segments.push(sentence)
      }
      buffer = ''
    }
  }

  const tail = buffer.trim()
  if (tail) {
    segments.push(tail)
  }

  return segments
}

function resolveGenderBySpeaker(speaker, index) {
  const normalized = speaker.toLowerCase()
  if (speaker.includes('男') || normalized.includes('host1') || normalized === 'a') {
    return 'male'
  }
  if (speaker.includes('女') || normalized.includes('host2') || normalized === 'b') {
    return 'female'
  }
  return index % 2 === 0 ? 'male' : 'female'
}

function buildSegments(lines) {
  const segments = []
  let fallbackSpeaker = ''

  for (const line of lines) {
    let speaker = fallbackSpeaker
    let content = line
    const colonIndex = (() => {
      const normal = line.indexOf(':')
      const cn = line.indexOf('：')
      if (normal === -1) {
        return cn
      }
      if (cn === -1) {
        return normal
      }
      return Math.min(normal, cn)
    })()

    if (colonIndex > 0 && colonIndex <= 24) {
      speaker = line.slice(0, colonIndex).trim()
      content = line.slice(colonIndex + 1).trim()
      fallbackSpeaker = speaker
    }
    if (!speaker) {
      throw new Error(`Line must include speaker marker like "男：...": ${line}`)
    }
    const sentences = splitSentences(content)
    for (const sentence of sentences) {
      segments.push({
        speaker,
        gender: resolveGenderBySpeaker(speaker, segments.length),
        text: sentence,
      })
    }
  }

  if (segments.length === 0) {
    throw new Error('No valid segments after sentence split')
  }
  return segments
}

function getMinimaxConfigFromEnv() {
  const groupId = process.env.TTS_API_ID || ''
  const apiKey = process.env.TTS_API_KEY || ''
  if (!groupId || !apiKey) {
    throw new Error('Missing TTS_API_ID or TTS_API_KEY in env')
  }
  const maxRpmRaw = Number.parseInt(process.env.MINIMAX_MAX_RPM || `${DEFAULT_MAX_RPM}`, 10)
  const maxRpm = Number.isFinite(maxRpmRaw) && maxRpmRaw > 0 ? maxRpmRaw : DEFAULT_MAX_RPM
  return {
    apiUrl: process.env.TTS_API_URL || 'https://api.minimaxi.com/v1/t2a_v2',
    groupId,
    apiKey,
    model: process.env.TTS_MODEL || 'speech-2.6-hd',
    speed: Number(process.env.AUDIO_SPEED || 1.0),
    languageBoost: process.env.LANGUAGE_BOOST || 'Chinese',
    maleVoiceId: process.env.MAN_VOICE_ID || 'Chinese (Mandarin)_Gentleman',
    femaleVoiceId: process.env.WOMAN_VOICE_ID || 'Chinese (Mandarin)_Gentle_Senior',
    minIntervalMs: Math.ceil(60000 / maxRpm) + DEFAULT_RPM_BUFFER_MS,
  }
}

async function waitForRateWindow(minIntervalMs) {
  const elapsed = Date.now() - lastRequestAt
  const waitMs = minIntervalMs - elapsed
  if (waitMs > 0) {
    await sleepMs(waitMs)
  }
  lastRequestAt = Date.now()
}

function isRateLimitError(message) {
  const normalized = message.toLowerCase()
  return normalized.includes('rate limit') && normalized.includes('rpm')
}

async function minimaxTTS(text, gender, config) {
  const voiceId = gender === 'male' ? config.maleVoiceId : config.femaleVoiceId

  for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt += 1) {
    await waitForRateWindow(config.minIntervalMs)

    try {
      const response = await fetch(`${config.apiUrl}?GroupId=${config.groupId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          text,
          timber_weights: [
            { voice_id: voiceId, weight: 100 },
          ],
          voice_setting: {
            voice_id: '',
            speed: config.speed,
            pitch: 0,
            vol: 1,
            latex_read: false,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: 'mp3',
          },
          language_boost: config.languageBoost,
        }),
      })

      const body = await response.json()
      const statusMsg = body?.base_resp?.status_msg || ''

      if (!response.ok) {
        const message = `MiniMax HTTP ${response.status}: ${statusMsg || response.statusText}`
        if (isRateLimitError(message) && attempt < DEFAULT_MAX_RETRIES) {
          const delayMs = DEFAULT_RETRY_BASE_MS * (attempt + 1)
          console.warn(`Rate limit, retry in ${delayMs}ms (attempt ${attempt + 1})`)
          await sleepMs(delayMs)
          continue
        }
        throw new Error(message)
      }

      if (body?.data?.audio) {
        return Buffer.from(body.data.audio, 'hex')
      }

      const errorMessage = `MiniMax API error: ${statusMsg || 'unknown'}`
      if (isRateLimitError(errorMessage) && attempt < DEFAULT_MAX_RETRIES) {
        const delayMs = DEFAULT_RETRY_BASE_MS * (attempt + 1)
        console.warn(`Rate limit, retry in ${delayMs}ms (attempt ${attempt + 1})`)
        await sleepMs(delayMs)
        continue
      }
      throw new Error(errorMessage)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isRateLimitError(message) && attempt < DEFAULT_MAX_RETRIES) {
        const delayMs = DEFAULT_RETRY_BASE_MS * (attempt + 1)
        console.warn(`Rate limit, retry in ${delayMs}ms (attempt ${attempt + 1})`)
        await sleepMs(delayMs)
        continue
      }
      throw error
    }
  }

  throw new Error('MiniMax TTS failed after retries')
}

function toConcatFileLine(filePath) {
  const escaped = filePath.replace(/'/g, `'\\''`)
  return `file '${escaped}'`
}

async function ensureFfmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version'])
  }
  catch {
    throw new Error('ffmpeg not found in PATH. Please install ffmpeg first.')
  }
}

async function concatWithFfmpeg(segmentFiles, outputPath) {
  await ensureFfmpegAvailable()

  const tempDir = await mkdtemp(resolve(tmpdir(), 'minimax-tts-'))
  const listPath = resolve(tempDir, 'concat.txt')
  const listText = segmentFiles.map(toConcatFileLine).join('\n')
  await writeFile(listPath, `${listText}\n`, 'utf8')

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      outputPath,
    ])
  }
  catch {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outputPath,
    ])
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function readDialogText(inputPath) {
  if (!inputPath) {
    return DEFAULT_DIALOG.join('\n')
  }
  const fullPath = resolve(process.cwd(), inputPath)
  return readFile(fullPath, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await loadEnvFromLocal()

  const rawDialog = await readDialogText(options.input)
  const lines = parseDialogLines(rawDialog)
  const segments = buildSegments(lines)

  console.info(`Input lines: ${lines.length}`)
  console.info(`Sentence segments: ${segments.length}`)

  if (options.dryRun) {
    for (const [index, segment] of segments.entries()) {
      console.info(`[${index}] ${segment.speaker} (${segment.gender}): ${segment.text}`)
    }
    console.info('Dry run completed.')
    return
  }

  const config = getMinimaxConfigFromEnv()
  console.info('MiniMax config:')
  console.info(`- model: ${config.model}`)
  console.info(`- min interval: ${config.minIntervalMs}ms`)
  console.info(`- output dir: ${options.outputDir}`)

  const outputDir = resolve(process.cwd(), options.outputDir)
  const segmentsDir = resolve(outputDir, 'segments')
  const mergedOutput = resolve(outputDir, options.outputFile)
  await mkdir(segmentsDir, { recursive: true })

  const segmentFiles = []
  for (const [index, segment] of segments.entries()) {
    const startedAt = Date.now()
    const audio = await minimaxTTS(segment.text, segment.gender, config)
    const fileName = `${String(index).padStart(3, '0')}-${segment.speaker}.mp3`
      .replaceAll('/', '_')
      .replaceAll('\\', '_')
      .replaceAll(' ', '_')
    const filePath = resolve(segmentsDir, fileName)
    await writeFile(filePath, audio)
    segmentFiles.push(filePath)
    console.info(`Generated [${index + 1}/${segments.length}] ${fileName} (${Date.now() - startedAt}ms)`)
  }

  await concatWithFfmpeg(segmentFiles, mergedOutput)

  console.info('Done.')
  console.info(`Segments: ${segmentsDir}`)
  console.info(`Merged file: ${mergedOutput}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
