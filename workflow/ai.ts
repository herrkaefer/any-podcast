import type { RuntimeAiConfig } from '@/types/runtime-config'
import { GoogleGenAI } from '@google/genai'

export type AiProvider = 'openai' | 'gemini' | 'minimax'

export interface AiEnv {
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
  MINIMAX_API_KEY?: string
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

interface ChatCompletionsBody {
  choices?: {
    message?: {
      content?: string | Array<{ type?: string, text?: string }>
    }
    finish_reason?: string
  }[]
  usage?: unknown
  error?: { message?: string }
}

interface ResponseTextResult {
  text: string
  usage?: unknown
  finishReason?: string
}

interface JsonSchemaObject {
  [key: string]: unknown
}

const defaultOpenAIBaseUrl = 'https://api.openai.com/v1'
const defaultMiniMaxBaseUrl = 'https://api.minimaxi.com/v1'

export type RuntimeAiOptions = RuntimeAiConfig

export function getAiProvider(env: AiEnv, options?: RuntimeAiOptions): AiProvider {
  const provider = options?.provider ?? (env.GEMINI_API_KEY?.trim() ? 'gemini' : 'openai')

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY?.trim()) {
      throw new Error('GEMINI_API_KEY is required when ai.provider=gemini')
    }
    return provider
  }

  if (provider === 'minimax') {
    if (!env.MINIMAX_API_KEY?.trim()) {
      throw new Error('MINIMAX_API_KEY is required when ai.provider=minimax')
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
  if (provider === 'minimax' && !env.MINIMAX_API_KEY?.trim()) {
    throw new Error('MINIMAX_API_KEY is required when ai.provider=minimax')
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
  return getPrimaryModel(env, provider, options)
}

export function getMaxTokens(_: AiEnv, _provider: AiProvider, options?: RuntimeAiOptions): number {
  void options
  return 8192
}

function buildResponsesUrl(): string {
  const normalized = defaultOpenAIBaseUrl.replace(/\/$/, '')
  return `${normalized}/responses`
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '')
  return `${normalized}/chat/completions`
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

function extractChatCompletionText(body: ChatCompletionsBody): string {
  const content = body.choices?.[0]?.message?.content
  const stripThinking = (value: string) => value.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  if (typeof content === 'string') {
    return stripThinking(content)
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return stripThinking(content
    .map(item => typeof item?.text === 'string' ? item.text : '')
    .join(''))
}

function toJsonSchema(schema: unknown): JsonSchemaObject {
  if (!schema || typeof schema !== 'object') {
    throw new Error('responseSchema must be an object')
  }

  const record = schema as Record<string, unknown>
  const rawType = typeof record.type === 'string' ? record.type.toUpperCase() : ''
  const nullable = record.nullable === true

  let jsonSchema: JsonSchemaObject
  switch (rawType) {
    case 'OBJECT': {
      const rawProperties = record.properties && typeof record.properties === 'object'
        ? record.properties as Record<string, unknown>
        : {}
      const properties = Object.fromEntries(
        Object.entries(rawProperties).map(([key, value]) => [key, toJsonSchema(value)]),
      )
      jsonSchema = {
        type: 'object',
        properties,
        additionalProperties: false,
      }
      if (Array.isArray(record.required) && record.required.every(item => typeof item === 'string')) {
        jsonSchema.required = record.required
      }
      break
    }
    case 'ARRAY': {
      jsonSchema = {
        type: 'array',
        items: toJsonSchema(record.items),
      }
      break
    }
    case 'STRING':
      jsonSchema = { type: 'string' }
      break
    case 'INTEGER':
      jsonSchema = { type: 'integer' }
      break
    case 'NUMBER':
      jsonSchema = { type: 'number' }
      break
    case 'BOOLEAN':
      jsonSchema = { type: 'boolean' }
      break
    default:
      throw new Error(`Unsupported responseSchema type: ${rawType || 'unknown'}`)
  }

  if (!nullable) {
    return jsonSchema
  }

  return {
    anyOf: [
      jsonSchema,
      { type: 'null' },
    ],
  }
}

function buildMiniMaxInstructions(
  instructions: string,
  responseMimeType?: string,
  responseSchema?: unknown,
): string {
  if (responseMimeType !== 'application/json') {
    return instructions
  }

  const schemaNote = responseSchema
    ? `\n\nReturn valid JSON matching this JSON Schema:\n${JSON.stringify(toJsonSchema(responseSchema))}`
    : ''
  return `${instructions}\n\nReturn only valid JSON. Do not wrap it in markdown fences or add extra text.${schemaNote}`
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

  if (provider === 'minimax') {
    if (!env.MINIMAX_API_KEY) {
      throw new Error('MINIMAX_API_KEY is required when using MiniMax API')
    }

    const url = buildChatCompletionsUrl(defaultMiniMaxBaseUrl)
    const body: Record<string, unknown> = {
      model,
      reasoning_split: true,
      messages: [
        {
          role: 'system',
          content: buildMiniMaxInstructions(instructions, responseMimeType, responseSchema),
        },
        {
          role: 'user',
          content: input,
        },
      ],
    }
    if (typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens)) {
      body.max_tokens = maxOutputTokens
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`MiniMax Chat Completions API error: ${response.status} ${response.statusText} ${errorText}`)
    }

    const data = (await response.json()) as ChatCompletionsBody
    if (data.error?.message) {
      throw new Error(`MiniMax Chat Completions API error: ${data.error.message}`)
    }

    const text = extractChatCompletionText(data)
    if (!text) {
      throw new Error('MiniMax Chat Completions API returned empty output')
    }

    return {
      text,
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
    }
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when using OpenAI API')
  }
  const url = buildResponsesUrl()
  const body: Record<string, unknown> = {
    model,
    instructions,
    input,
  }
  if (typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens)) {
    body.max_output_tokens = maxOutputTokens
  }
  if (responseMimeType === 'application/json' && responseSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: 'structured_output',
        strict: true,
        schema: toJsonSchema(responseSchema),
      },
    }
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
