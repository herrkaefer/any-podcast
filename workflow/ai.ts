import type { RuntimeAiConfig } from '@/types/runtime-config'
import { GoogleGenAI } from '@google/genai'

export type AiProvider = 'openai' | 'gemini'

export interface AiEnv {
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
}

interface ResponsesMessageContent {
  type?: string
  text?: string
}

interface ResponsesOutputItem {
  type?: string
  role?: string
  content?: ResponsesMessageContent[]
}

interface ResponsesBody {
  output_text?: string
  output?: ResponsesOutputItem[]
  usage?: unknown
  status?: string
  error?: { message?: string }
}

interface ResponseTextResult {
  text: string
  usage?: unknown
  finishReason?: string
}

const defaultOpenAIBaseUrl = 'https://api.openai.com/v1'

export type RuntimeAiOptions = RuntimeAiConfig

export function getAiProvider(env: AiEnv, options?: RuntimeAiOptions): AiProvider {
  const provider = options?.provider ?? (env.GEMINI_API_KEY?.trim() ? 'gemini' : 'openai')

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY?.trim()) {
      throw new Error('GEMINI_API_KEY is required when ai.provider=gemini')
    }
    return provider
  }

  if (!env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is required when ai.provider=openai')
  }
  return provider
}

export function getPrimaryModel(env: AiEnv, provider: AiProvider, options?: RuntimeAiOptions): string {
  if (provider === 'gemini' && !env.GEMINI_API_KEY?.trim()) {
    throw new Error('GEMINI_API_KEY is required when ai.provider=gemini')
  }
  if (provider === 'openai' && !env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is required when ai.provider=openai')
  }

  const model = options?.model?.trim()
  if (!model) {
    throw new Error('runtime config ai.model is required')
  }
  return model
}

export function getThinkingModel(env: AiEnv, provider: AiProvider, options?: RuntimeAiOptions): string {
  const thinkingModel = options?.thinkingModel?.trim()
  if (thinkingModel) {
    return thinkingModel
  }
  return getPrimaryModel(env, provider, options)
}

export function getMaxTokens(_: AiEnv, _provider: AiProvider, options?: RuntimeAiOptions): number {
  const parsed = Number(options?.maxTokens)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return 8192
}

function buildResponsesUrl(baseUrl?: string): string {
  const normalized = (baseUrl || defaultOpenAIBaseUrl).replace(/\/$/, '')
  return `${normalized}/responses`
}

function extractOutputText(body: ResponsesBody): string {
  if (typeof body.output_text === 'string') {
    return body.output_text
  }
  if (!Array.isArray(body.output)) {
    return ''
  }
  const texts: string[] = []
  for (const item of body.output) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) {
      continue
    }
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text)
      }
      else if (content?.type === 'text' && typeof content.text === 'string') {
        texts.push(content.text)
      }
    }
  }
  return texts.join('')
}

export async function createResponseText(params: {
  env: AiEnv
  runtimeAi?: RuntimeAiOptions
  model: string
  instructions: string
  input: string
  maxOutputTokens?: number
  responseMimeType?: string
  responseSchema?: unknown
}): Promise<ResponseTextResult> {
  const {
    env,
    runtimeAi,
    model,
    instructions,
    input,
    maxOutputTokens,
    responseMimeType,
    responseSchema,
  } = params
  const provider = getAiProvider(env, runtimeAi)

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required when using Gemini API')
    }
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, vertexai: false })
    const config: Record<string, unknown> = {
      systemInstruction: instructions,
    }
    if (typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens)) {
      config.maxOutputTokens = maxOutputTokens
    }
    if (responseMimeType) {
      config.responseMimeType = responseMimeType
    }
    if (responseSchema) {
      config.responseSchema = responseSchema
    }
    const response = await ai.models.generateContent({
      model,
      contents: input,
      config,
    })
    const text = response.text
    if (!text) {
      throw new Error('Gemini generateContent returned empty output')
    }
    const candidate = (response as { candidates?: { finishReason?: string, finishMessage?: string }[] }).candidates?.[0]
    return {
      text,
      usage: (response as { usageMetadata?: unknown }).usageMetadata,
      finishReason: candidate?.finishReason || candidate?.finishMessage,
    }
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when using OpenAI API')
  }
  const url = buildResponsesUrl(runtimeAi?.baseUrl)
  const body: Record<string, unknown> = {
    model,
    instructions,
    input,
  }
  if (typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens)) {
    body.max_output_tokens = maxOutputTokens
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI Responses API error: ${response.status} ${response.statusText} ${errorText}`)
  }

  const data = (await response.json()) as ResponsesBody
  if (data.error?.message) {
    throw new Error(`OpenAI Responses API error: ${data.error.message}`)
  }

  const text = extractOutputText(data)
  if (!text) {
    throw new Error('OpenAI Responses API returned empty output')
  }

  return {
    text,
    usage: data.usage,
    finishReason: data.status,
  }
}
