import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'

await loadEnvFromLocal()

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  throw new Error('缺少 GEMINI_API_KEY，请先在环境变量中配置。')
}

const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
const outputDir = process.env.GEMINI_TTS_OUTPUT || 'tmp/gemini-tts-batch'
const BATCH_SIZE = 8

const dialogLines = [
  'Host1：大家好，欢迎收听本期播客，我是 Host1。',
  'Host2：大家好，我是 Host2。',
  'Host1：今天我们来聊一个跟开发者工作流相关的话题。最近有一个新的开源工具引起了不少关注，它号称能把日常的重复工作减少一半以上。',
  'Host2：对，这个工具最大的亮点是它的自动化能力。它能自动识别项目中的重复模式，然后帮你生成对应的脚手架代码。',
  'Host1：听起来确实挺实用。但我有个疑问，这跟之前的代码生成器有什么本质区别？',
  'Host2：区别在于上下文感知。之前的工具大多是基于模板的，你得手动选模板、填参数。而这个工具会分析你现有的代码风格和项目结构，生成的代码和你的项目高度一致。',
  'Host1：那安全性怎么样？自动生成的代码会不会引入漏洞？',
  'Host2：这是个好问题。它内置了一些基本的安全检查，但不能完全替代代码审查。官方建议是把它当作"初稿生成器"，最终还是需要人工确认。',
  'Host1：嗯，这个定位很务实。不追求完全自动化，而是帮你加速到 80%，剩下 20% 靠人来把关。',
  'Host2：没错。社区里也有一些讨论，有人觉得它在小项目上效果惊人，但在大型项目里还需要更多配置。',
  'Host1：看来任何工具都有它的适用边界。好了，今天就聊到这里。',
  'Host2：感谢收听，我们下期再见。',
  'Host1：再见。',
]

// Build prompt matching production: workflow/tts.ts buildGeminiTtsPrompt
function buildPrompt(lines) {
  return [
    '请用中文朗读以下播客对话内容。',
    '',
    '整体要求：',
    '语气自然、克制、亲切，像两位熟悉的播客主持人在安静的环境中对话。',
    '节奏平稳，不急不慢，不制造紧张感，不刻意强调结论。',
    '音量保持一致，避免情绪起伏过大，整体听感放松、可信。',
    '',
    'Host1：',
    '温和、亲切的播客主持人。',
    '语速中等，语调自然，有耐心。',
    '说话方式像在和普通听众聊天，善于提问和承接话题。',
    '',
    'Host2：',
    '成熟、知性的播客主持人。',
    '语速中等偏慢，声线温和沉稳。',
    '表达清晰、有逻辑，但不过度强调专业性。',
    '',
    '朗读风格补充：',
    '- 像真实对话，而不是朗读稿件',
    '- 允许自然停顿和轻微犹豫感',
    '- 避免"新闻播报""课堂讲解""宣传解说"的语气',
    '- 始终以"陪伴式解释"为核心，而不是输出结论',
    '',
    ...lines,
  ].join('\n')
}

// Split into batches
const batches = []
for (let i = 0; i < dialogLines.length; i += BATCH_SIZE) {
  batches.push(dialogLines.slice(i, i + BATCH_SIZE))
}

console.info(`共 ${dialogLines.length} 行对话，分为 ${batches.length} 个批次（每批 ${BATCH_SIZE} 行）`)

const ai = new GoogleGenAI({ apiKey })

const config = {
  temperature: 0.1,
  responseModalities: ['AUDIO'],
  speechConfig: {
    multiSpeakerVoiceConfig: {
      speakerVoiceConfigs: [
        {
          speaker: 'Host1',
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
        {
          speaker: 'Host2',
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      ],
    },
  },
}

await mkdir(outputDir, { recursive: true })

for (const [batchIndex, batch] of batches.entries()) {
  const prompt = buildPrompt(batch)
  console.info(`\n--- 批次 ${batchIndex} (${batch.length} 行, ${prompt.length} 字符) ---`)
  console.info(`首行: ${batch[0].substring(0, 40)}...`)

  let response
  const startedAt = Date.now()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config,
      })
      break
    }
    catch (error) {
      const status = error?.status || error?.response?.status
      if ((status === 500 || status === 503) && attempt < 2) {
        const delay = (attempt + 1) * 3000
        console.warn(`批次 ${batchIndex} 服务端错误 (${status})，${delay / 1000}s 后重试...`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw error
    }
  }
  const ms = Date.now() - startedAt

  const candidate = response?.candidates?.[0]
  const inlineData = candidate?.content?.parts?.[0]?.inlineData
  if (!inlineData?.data) {
    console.error(`批次 ${batchIndex} 未获取到音频数据`)
    console.error('response.candidates:', JSON.stringify(response?.candidates, null, 2))
    console.error('finishReason:', candidate?.finishReason)
    console.error('safetyRatings:', JSON.stringify(candidate?.safetyRatings, null, 2))
    console.error('promptFeedback:', JSON.stringify(response?.promptFeedback, null, 2))
    continue
  }

  const mimeType = inlineData.mimeType || ''
  const rawBuffer = Buffer.from(inlineData.data, 'base64')

  let outputBuffer = rawBuffer
  let fileExtension = getExtensionFromMime(mimeType)

  if (!fileExtension) {
    fileExtension = 'wav'
    outputBuffer = convertToWav(rawBuffer, mimeType)
  }

  const filePath = resolve(outputDir, `batch-${batchIndex}.${fileExtension}`)
  await writeFile(filePath, outputBuffer)
  console.info(`批次 ${batchIndex} 完成: ${filePath} (${(outputBuffer.length / 1024 / 1024).toFixed(1)}MB, ${ms}ms)`)
}

console.info(`\n全部完成，音频文件保存在 ${outputDir}/`)

// --- 工具函数 ---

function getExtensionFromMime(mimeType) {
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

function convertToWav(buffer, mimeType) {
  const options = parseMimeType(mimeType)
  const wavHeader = createWavHeader(buffer.length, options)
  return Buffer.concat([wavHeader, buffer])
}

function parseMimeType(mimeType) {
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

function createWavHeader(dataLength, options) {
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
  const lines = content.split(/\r?\n/)
  const entries = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const index = trimmed.indexOf('=')
    if (index === -1) {
      continue
    }
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    }
    if (key) {
      entries.push([key, value])
    }
  }
  return entries
}
