import { Buffer } from 'node:buffer'
import { synthesize } from '@echristian/edge-tts'
import { GoogleGenAI } from '@google/genai'
import { $fetch } from 'ofetch'

interface Env extends CloudflareEnv {
  TTS_API_ID?: string
  TTS_API_KEY?: string
  GEMINI_API_KEY?: string
}

export interface GeminiSpeakerConfig {
  speaker: string
  voice?: string
}

export interface RuntimeTtsOptions {
  provider?: 'edge' | 'minimax' | 'murf' | 'gemini'
  language?: string
  languageBoost?: 'auto' | 'Chinese' | 'English'
  model?: string
  speed?: string | number
  apiUrl?: string
  voicesBySpeaker?: Record<string, string>
  geminiPrompt?: string
  geminiSpeakers?: GeminiSpeakerConfig[]
}

interface GeminiAudioResult {
  audio: Blob
  extension: string
  mimeType: string
}

interface GeminiRetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
}

const MINIMAX_MAX_RPM = 60
const MINIMAX_MIN_INTERVAL_MS = Math.ceil(60000 / MINIMAX_MAX_RPM) + 150
const MINIMAX_MAX_RETRIES = 3
const MINIMAX_RETRY_BASE_DELAY_MS = 1500
const GEMINI_DEFAULT_MAX_ATTEMPTS = 5
const GEMINI_DEFAULT_BASE_DELAY_MS = 8000
const GEMINI_DEFAULT_MAX_DELAY_MS = 90000
const GEMINI_DEFAULT_JITTER_RATIO = 0.25

let minimaxLastRequestAt = 0

function sleepMs(ms: number) {
  if (ms <= 0) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isMinimaxRpmLimitErrorMessage(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('rate limit') && normalized.includes('rpm')
}

function toNumericCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function extractGeminiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const record = error as Record<string, unknown>
  const direct = toNumericCode(record.status) ?? toNumericCode(record.code)
  if (direct !== undefined) {
    return direct
  }

  const response = record.response
  if (response && typeof response === 'object') {
    const responseRecord = response as Record<string, unknown>
    const responseStatus = toNumericCode(responseRecord.status)
    if (responseStatus !== undefined) {
      return responseStatus
    }
  }

  const cause = record.cause
  if (cause && typeof cause === 'object') {
    const causeRecord = cause as Record<string, unknown>
    const causeStatus = toNumericCode(causeRecord.status) ?? toNumericCode(causeRecord.code)
    if (causeStatus !== undefined) {
      return causeStatus
    }
  }

  return undefined
}

function summarizeGeminiRetryError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return {
      message: String(error),
      status: undefined,
      code: undefined,
    }
  }

  const record = error as Record<string, unknown>
  const message = typeof record.message === 'string'
    ? record.message
    : String(error)
  const code = toNumericCode(record.code) ?? record.code
  const status = extractGeminiErrorStatus(error)
  const name = typeof record.name === 'string'
    ? record.name
    : undefined

  return {
    name,
    message,
    status,
    code,
  }
}

function isRetryableGeminiError(error: unknown) {
  const status = extractGeminiErrorStatus(error)
  if (status !== undefined) {
    const retryableStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 523, 524])
    if (retryableStatus.has(status)) {
      return true
    }
  }

  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase()

  return (
    message.includes('error code: 524')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('rate limit')
    || message.includes('temporarily unavailable')
    || message.includes('gateway')
    || message.includes('upstream')
    || message.includes('econnreset')
    || message.includes('eai_again')
    || message.includes('etimedout')
  )
}

function computeRetryDelayMs(
  attempt: number,
  options: Required<GeminiRetryOptions>,
) {
  const expDelay = options.baseDelayMs * 2 ** Math.max(0, attempt - 1)
  const cappedDelay = Math.min(expDelay, options.maxDelayMs)
  const jitterRange = Math.max(0, options.jitterRatio)
  const jitterFactor = 1 + (Math.random() * 2 - 1) * jitterRange
  return Math.max(1000, Math.round(cappedDelay * jitterFactor))
}

async function waitForMinimaxRateLimitWindow() {
  const elapsed = Date.now() - minimaxLastRequestAt
  const waitMs = MINIMAX_MIN_INTERVAL_MS - elapsed
  if (waitMs > 0) {
    await sleepMs(waitMs)
  }
  minimaxLastRequestAt = Date.now()
}

function resolveRateForEdge(speed: string | number | undefined, fallback: string) {
  if (typeof speed === 'number') {
    return `${speed}%`
  }
  return speed || fallback
}

function resolveVoiceBySpeaker(
  speaker: string,
  options: RuntimeTtsOptions | undefined,
  defaults: { male: string, female: string },
) {
  const mapped = options?.voicesBySpeaker?.[speaker]
  if (mapped) {
    return mapped
  }
  // Use speaker order: first speaker in voicesBySpeaker maps to male, rest to female
  if (options?.voicesBySpeaker) {
    const speakers = Object.keys(options.voicesBySpeaker)
    if (speakers.length > 0) {
      return speaker === speakers[0] ? defaults.male : defaults.female
    }
  }
  return defaults.male
}

async function edgeTTS(text: string, speaker: string, env: Env, options?: RuntimeTtsOptions) {
  void env
  const { audio } = await synthesize({
    text,
    language: options?.language || 'zh-CN',
    voice: resolveVoiceBySpeaker(speaker, options, {
      male: 'zh-CN-YunyangNeural',
      female: 'zh-CN-XiaoxiaoNeural',
    }),
    rate: resolveRateForEdge(options?.speed, '10%'),
  })
  return audio
}

async function minimaxTTS(text: string, speaker: string, env: Env, options?: RuntimeTtsOptions) {
  const apiUrl = options?.apiUrl || 'https://api.minimaxi.com/v1/t2a_v2'
  for (let attempt = 0; attempt <= MINIMAX_MAX_RETRIES; attempt += 1) {
    await waitForMinimaxRateLimitWindow()
    try {
      const result = await $fetch<{ data: { audio: string }, base_resp: { status_msg: string } }>(`${apiUrl}?GroupId=${env.TTS_API_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.TTS_API_KEY}`,
        },
        timeout: 30000,
        body: JSON.stringify({
          model: options?.model || 'speech-2.6-hd',
          text,
          timber_weights: [
            {
              voice_id: resolveVoiceBySpeaker(speaker, options, {
                male: 'Chinese (Mandarin)_Gentleman',
                female: 'Chinese (Mandarin)_Gentle_Senior',
              }),
              weight: 100,
            },
          ],
          voice_setting: {
            voice_id: '',
            speed: Number(options?.speed ?? 1.1),
            pitch: 0,
            vol: 1,
            latex_read: false,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: 'mp3',
          },
          language_boost: options?.languageBoost || 'Chinese',
        }),
      })

      if (result?.data?.audio) {
        const buffer = Buffer.from(result.data.audio, 'hex')
        return new Blob([buffer], { type: 'audio/mpeg' })
      }

      const statusMessage = result?.base_resp?.status_msg || 'unknown error'
      if (isMinimaxRpmLimitErrorMessage(statusMessage) && attempt < MINIMAX_MAX_RETRIES) {
        const backoffMs = MINIMAX_RETRY_BASE_DELAY_MS * (attempt + 1)
        console.warn('Minimax TTS RPM limit reached, backing off', {
          attempt: attempt + 1,
          retryInMs: backoffMs,
          statusMessage,
        })
        await sleepMs(backoffMs)
        continue
      }

      throw new Error(`Failed to fetch audio: ${statusMessage}`)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isMinimaxRpmLimitErrorMessage(message) && attempt < MINIMAX_MAX_RETRIES) {
        const backoffMs = MINIMAX_RETRY_BASE_DELAY_MS * (attempt + 1)
        console.warn('Minimax TTS request rate limited, retrying', {
          attempt: attempt + 1,
          retryInMs: backoffMs,
          message,
        })
        await sleepMs(backoffMs)
        continue
      }
      throw error
    }
  }

  throw new Error('Failed to fetch audio: rate limit exceeded(RPM) after retries')
}

/**
 * murf.ai 语音合成服务每月$10的免费额度，相对于 minimax 收费，没有预算的用户可以使用
 * 使用 Murf 语音合成服务将文本转换为音频。
 * 根据 `speaker` 选择不同的预设音色，并通过 runtime config 调整语速等参数。
 *
 * @param text 要合成的文本内容
 * @param speaker 说话人标识：优先按 `voicesBySpeaker` 匹配，否则回退默认音色
 * @param env 运行环境配置，包含 `TTS_API_KEY` 等凭证
 * @param options 运行时 TTS 参数（语言、模型、语速、speaker->voice 映射等）
 * @returns 返回包含 MP3 数据的 `Blob`
 * @throws 当请求失败或服务返回非 2xx 状态码时抛出错误
 * @apiUrl https://murf.ai/api/docs/api-reference/text-to-speech/stream?explorer=true
 * @getKeyUrl https://murf.ai/api/api-keys
 */
async function murfTTS(text: string, speaker: string, env: Env, options?: RuntimeTtsOptions) {
  const apiUrl = options?.apiUrl || 'https://api.murf.ai/v1/speech/stream'
  const result = await $fetch(`${apiUrl}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': `${env.TTS_API_KEY}`,
    },
    timeout: 30000,
    // en-UK-ruby 女声1
    // zh-CN-wei 女声2
    // en-US-ken 男声1
    // zh-CN-tao 男声2
    // pl-PL-jacek 男声3
    body: JSON.stringify({
      text,
      voiceId: resolveVoiceBySpeaker(speaker, options, {
        male: 'en-US-ken',
        female: 'en-UK-ruby',
      }),
      model: options?.model || 'GEN2',
      multiNativeLocale: options?.language || 'zh-CN',
      style: 'Conversational',
      rate: Number(options?.speed ?? -8),
      pitch: 0,
      format: 'MP3',
    }),
  })

  if (result.ok) {
    const body = await result.arrayBuffer()
    const buffer = Buffer.from(body)
    return new Blob([buffer.buffer], { type: 'audio/mpeg' })
  }
  throw new Error(`Failed to fetch audio: ${result.statusText}`)
}

export function buildGeminiTtsPrompt(lines: string[], options?: RuntimeTtsOptions): string {
  const availableSpeakers = options?.geminiSpeakers?.map(item => item.speaker).filter(Boolean)
  if (!availableSpeakers || availableSpeakers.length === 0) {
    throw new Error('Gemini TTS requires geminiSpeakers config with at least one speaker')
  }
  const speakers = availableSpeakers
  const cleaned = lines
    .map(line => line.trim())
    .filter(line => line && speakers.some(speaker => line.startsWith(speaker)))
  if (!cleaned.length) {
    throw new Error('Gemini TTS prompt is empty: no valid speaker lines found')
  }
  return [
    options?.geminiPrompt || '请用中文播报以下播客对话，语气自然、节奏流畅、音量稳定。',
    ...cleaned,
  ].join('\n')
}

export async function synthesizeGeminiTTS(text: string, env: Env, options?: RuntimeTtsOptions): Promise<GeminiAudioResult> {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required when using Gemini TTS')
  }

  const model = options?.model || 'gemini-2.5-flash-preview-tts'
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
  const startedAt = Date.now()
  console.info('Gemini TTS request start', {
    model,
    promptChars: text.length,
  })

  const generateStartedAt = Date.now()
  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text }] }],
    config: {
      temperature: 1.0,
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: (options?.geminiSpeakers && options.geminiSpeakers.length > 0
            ? options.geminiSpeakers
            : [
                {
                  speaker: 'Host1',
                  voice: 'Puck',
                },
                {
                  speaker: 'Host2',
                  voice: 'Zephyr',
                },
              ]).map((item, index) => {
            const fallbackVoice = index === 0
              ? 'Puck'
              : 'Zephyr'
            return {
              speaker: item.speaker,
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: item.voice || fallbackVoice,
                },
              },
            }
          }),
        },
      },
    },
  })
  const generateMs = Date.now() - generateStartedAt
  console.info('Gemini TTS generate done', {
    model,
    ms: generateMs,
  })

  const decodeStartedAt = Date.now()
  const inlineData = extractInlineData(response)
  if (!inlineData?.data) {
    console.warn('Gemini TTS returned no inline audio data', summarizeGeminiAudioResponse(response))
    throw new Error('Gemini TTS returned empty audio data')
  }

  const mimeType = inlineData.mimeType || 'audio/wav'
  let buffer = Buffer.from(inlineData.data, 'base64')
  let extension = getExtensionFromMime(mimeType)
  let finalMimeType = mimeType

  if (!extension) {
    extension = 'wav'
    buffer = convertToWav(buffer, mimeType)
    finalMimeType = 'audio/wav'
  }

  const audio = new Blob([buffer], { type: finalMimeType })
  const decodeMs = Date.now() - decodeStartedAt
  const totalMs = Date.now() - startedAt
  console.info('Gemini TTS decode done', {
    model,
    mimeType: finalMimeType,
    bytes: buffer.length,
    decodeMs,
    totalMs,
  })
  return { audio, extension, mimeType: finalMimeType }
}

export async function synthesizeGeminiTTSWithRetry(
  text: string,
  env: Env,
  options?: RuntimeTtsOptions,
  retryOptions?: GeminiRetryOptions,
): Promise<GeminiAudioResult> {
  const resolvedOptions: Required<GeminiRetryOptions> = {
    maxAttempts: Math.max(1, Math.floor(retryOptions?.maxAttempts ?? GEMINI_DEFAULT_MAX_ATTEMPTS)),
    baseDelayMs: Math.max(1000, Math.floor(retryOptions?.baseDelayMs ?? GEMINI_DEFAULT_BASE_DELAY_MS)),
    maxDelayMs: Math.max(1000, Math.floor(retryOptions?.maxDelayMs ?? GEMINI_DEFAULT_MAX_DELAY_MS)),
    jitterRatio: Math.max(0, retryOptions?.jitterRatio ?? GEMINI_DEFAULT_JITTER_RATIO),
  }

  for (let attempt = 1; attempt <= resolvedOptions.maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        console.info('Gemini TTS retry attempt started', {
          attempt,
          maxAttempts: resolvedOptions.maxAttempts,
          promptChars: text.length,
        })
      }
      return await synthesizeGeminiTTS(text, env, options)
    }
    catch (error) {
      const retryable = isRetryableGeminiError(error)
      const shouldRetry = retryable && attempt < resolvedOptions.maxAttempts
      const errorSummary = summarizeGeminiRetryError(error)

      if (!shouldRetry) {
        console.error('Gemini TTS failed', {
          attempt,
          maxAttempts: resolvedOptions.maxAttempts,
          retryable,
          error: errorSummary,
        })
        throw error
      }

      const delayMs = computeRetryDelayMs(attempt, resolvedOptions)
      console.warn('Gemini TTS attempt failed, will retry', {
        attempt,
        maxAttempts: resolvedOptions.maxAttempts,
        retryInMs: delayMs,
        error: errorSummary,
      })
      await sleepMs(delayMs)
    }
  }

  throw new Error('Gemini TTS failed after retries')
}

export default function (text: string, speaker: string, env: Env, options?: RuntimeTtsOptions) {
  const provider = options?.provider || 'edge'
  console.info('TTS provider', provider)
  switch (provider) {
    case 'minimax':
      return minimaxTTS(text, speaker, env, options)
    case 'murf':
      return murfTTS(text, speaker, env, options)
    case 'gemini':
      throw new Error('Gemini TTS only supports full podcast synthesis, not per-line synthesis')
    default:
      return edgeTTS(text, speaker, env, options)
  }
}

function extractInlineData(response: unknown) {
  const record = response && typeof response === 'object'
    ? response as Record<string, unknown>
    : {}
  const candidates = Array.isArray(record.candidates) ? record.candidates : []
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }
    const content = (candidate as Record<string, unknown>).content
    if (!content || typeof content !== 'object') {
      continue
    }
    const parts = Array.isArray((content as Record<string, unknown>).parts)
      ? (content as Record<string, unknown>).parts as unknown[]
      : []
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        continue
      }
      const inlineData = (part as Record<string, unknown>).inlineData
      if (inlineData && typeof inlineData === 'object') {
        const data = (inlineData as Record<string, unknown>).data
        const mimeType = (inlineData as Record<string, unknown>).mimeType
        if (typeof data === 'string' && data) {
          return {
            data,
            mimeType: typeof mimeType === 'string' ? mimeType : undefined,
          }
        }
      }

      // Extra compatibility path: some raw payloads may still use snake_case.
      const inlineDataSnake = (part as Record<string, unknown>).inline_data
      if (inlineDataSnake && typeof inlineDataSnake === 'object') {
        const data = (inlineDataSnake as Record<string, unknown>).data
        const mimeType = (inlineDataSnake as Record<string, unknown>).mime_type
        if (typeof data === 'string' && data) {
          return {
            data,
            mimeType: typeof mimeType === 'string' ? mimeType : undefined,
          }
        }
      }
    }
  }
  return null
}

function summarizeGeminiAudioResponse(response: unknown) {
  const record = response && typeof response === 'object'
    ? response as Record<string, unknown>
    : {}
  const candidates = Array.isArray(record.candidates) ? record.candidates : []
  const summary = candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      return {
        index,
        finishReason: undefined,
        parts: [],
      }
    }
    const candidateRecord = candidate as Record<string, unknown>
    const content = candidateRecord.content
    const parts = content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts)
      ? (content as Record<string, unknown>).parts as Array<Record<string, unknown>>
      : []
    return {
      index,
      finishReason: candidateRecord.finishReason,
      parts: parts.map((part) => {
        const keys = Object.keys(part || {})
        const text = typeof part?.text === 'string' ? part.text : ''
        return {
          keys,
          hasInlineData: Boolean(
            part?.inlineData && typeof part.inlineData === 'object' && typeof (part.inlineData as Record<string, unknown>).data === 'string',
          ) || Boolean(
            part?.inline_data && typeof part.inline_data === 'object' && typeof (part.inline_data as Record<string, unknown>).data === 'string',
          ),
          textPreview: text ? text.slice(0, 200) : '',
        }
      }),
    }
  })

  const responseText = typeof (record as { text?: unknown }).text === 'string'
    ? (record as { text: string }).text.slice(0, 200)
    : ''

  return {
    candidateCount: candidates.length,
    promptFeedback: record.promptFeedback,
    responseText,
    candidates: summary,
  }
}

function getExtensionFromMime(mimeType: string) {
  const [fileType] = mimeType.split(';').map(part => part.trim())
  if (!fileType) {
    return ''
  }
  const [, subtype] = fileType.split('/')
  if (!subtype) {
    return ''
  }
  if (subtype === 'wav' || subtype === 'x-wav') {
    return 'wav'
  }
  if (subtype === 'mpeg') {
    return 'mp3'
  }
  if (subtype === 'ogg') {
    return 'ogg'
  }
  if (subtype === 'webm') {
    return 'webm'
  }
  return ''
}

function convertToWav(buffer: Buffer, mimeType: string) {
  const options = parseMimeType(mimeType)
  const wavHeader = createWavHeader(buffer.length, options)
  return Buffer.concat([wavHeader, buffer])
}

function parseMimeType(mimeType: string) {
  const [fileType, ...params] = mimeType.split(';').map(part => part.trim())
  const [, format] = fileType.split('/')

  const options = {
    numChannels: 1,
    sampleRate: 24000,
    bitsPerSample: 16,
  }

  if (format && format.startsWith('L')) {
    const bits = Number.parseInt(format.slice(1), 10)
    if (!Number.isNaN(bits)) {
      options.bitsPerSample = bits
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(part => part.trim())
    if (key === 'rate') {
      const rate = Number.parseInt(value, 10)
      if (!Number.isNaN(rate)) {
        options.sampleRate = rate
      }
    }
  }

  return options
}

function createWavHeader(dataLength: number, options: { numChannels: number, sampleRate: number, bitsPerSample: number }) {
  const { numChannels, sampleRate, bitsPerSample } = options
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const buffer = Buffer.alloc(44)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)

  return buffer
}
