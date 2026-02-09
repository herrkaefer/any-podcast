import type { AiEnv } from '../ai'
import type { LinkRules, SourceConfig } from './types'

import { createResponseText, getAiProvider, getPrimaryModel } from '../ai'
import { extractNewsletterLinksPrompt } from '../prompt'

export interface NewsletterLinkCandidate {
  title?: string
  link: string
}

interface NewsletterEnv extends AiEnv {
  JINA_KEY?: string
  NODE_ENV?: string
}

export const MAX_NEWSLETTER_LINKS = 10

export const newsletterLinkSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      link: { type: 'STRING' },
      title: { type: 'STRING', nullable: true },
    },
    required: ['link'],
  },
} as const

export const trackingHostnames = [
  'list-manage.com',
  'campaign-archive.com',
  'mailchi.mp',
  'clicks',
  'links',
]

export function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export function unwrapTrackingUrl(href: string) {
  let url: URL
  try {
    url = new URL(href)
  }
  catch {
    return { href, unwrapped: false }
  }

  const hostname = url.hostname.toLowerCase()
  const isTrackingHost = trackingHostnames.some(keyword => hostname.includes(keyword))
  const isTrackingPath = url.pathname.toLowerCase().includes('/track/')

  if (!isTrackingHost && !isTrackingPath) {
    return { href, unwrapped: false }
  }

  const candidates = ['url', 'u', 'redirect', 'link', 'r', 'destination']
  for (const key of candidates) {
    const value = url.searchParams.get(key)
    if (!value) {
      continue
    }
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return { href: decoded, unwrapped: true }
    }
  }

  return { href, unwrapped: false }
}

export async function resolveTrackingRedirect(href: string, cache: Map<string, string>) {
  if (cache.has(href)) {
    return cache.get(href) || href
  }

  let url: URL
  try {
    url = new URL(href)
  }
  catch {
    cache.set(href, href)
    return href
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(href, { redirect: 'manual', signal: controller.signal })
    clearTimeout(timeout)

    const location = response.headers.get('location')
    if (location) {
      const resolved = location.startsWith('http')
        ? location
        : new URL(location, url.origin).toString()
      cache.set(href, resolved)
      return resolved
    }
  }
  catch {
    // ignore and fall back to original
  }

  cache.set(href, href)
  return href
}

export function normalizeUrl(input: string) {
  const trimmed = input.trim().replace(/[),.\]]+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    return ''
  }
  try {
    return new URL(trimmed).toString()
  }
  catch {
    return ''
  }
}

export function getUrlKey(input: string) {
  try {
    const url = new URL(input)
    url.hash = ''
    return url.toString()
  }
  catch {
    return input
  }
}

function stripCodeFences(text: string) {
  return text.replace(/```(?:json)?/gi, '').trim()
}

function extractJsonArray(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
  }
  const match = trimmed.match(/\[[\s\S]*\]/)
  return match ? match[0] : ''
}

export function parseNewsletterLinks(text: string): NewsletterLinkCandidate[] {
  const cleaned = stripCodeFences(text)
  const json = extractJsonArray(cleaned)
  if (!json) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const results: NewsletterLinkCandidate[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const link = typeof record.link === 'string'
      ? record.link
      : typeof record.url === 'string'
        ? record.url
        : ''
    if (!link) {
      continue
    }
    const title = typeof record.title === 'string' ? record.title : undefined
    results.push({
      link: link.trim(),
      title: title?.trim(),
    })
  }
  return results
}

export function buildNewsletterInput(params: {
  subject: string
  content: string
  rules?: LinkRules
}) {
  const { subject, content, rules } = params
  const lines: string[] = []
  lines.push(`【邮件主题】${subject || '（无主题）'}`)
  if (rules?.includeDomains && rules.includeDomains.length > 0) {
    lines.push(`【仅允许域名】${rules.includeDomains.join(', ')}`)
  }
  if (rules?.excludeDomains && rules.excludeDomains.length > 0) {
    lines.push(`【排除域名】${rules.excludeDomains.join(', ')}`)
  }
  if (rules?.excludePathKeywords && rules.excludePathKeywords.length > 0) {
    lines.push(`【排除路径关键词】${rules.excludePathKeywords.join(', ')}`)
  }
  if (rules?.excludeText && rules.excludeText.length > 0) {
    lines.push(`【额外排除文本】${rules.excludeText.join(', ')}`)
  }
  lines.push('【内容】')
  lines.push(content)
  return lines.join('\n')
}

export async function extractNewsletterLinksWithAi(params: {
  subject: string
  content: string
  source: SourceConfig
  env: NewsletterEnv
  messageId: string
  receivedAt: string
}) {
  const { subject, content, source, env, messageId, receivedAt } = params
  const rules = source.linkRules
  const provider = getAiProvider(env)
  const model = getPrimaryModel(env, provider)
  const input = buildNewsletterInput({ subject, content, rules })
  const maxOutputTokens = 8192

  const response = await createResponseText({
    env,
    model,
    instructions: extractNewsletterLinksPrompt,
    input,
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: newsletterLinkSchema,
  })

  if (rules?.debug) {
    console.info('newsletter ai raw response', {
      subject,
      messageId,
      receivedAt,
      provider,
      model,
      outputLength: response.text.length,
      finishReason: response.finishReason,
      output: response.text,
    })
  }

  let rawCandidates = parseNewsletterLinks(response.text)
  if (rawCandidates.length === 0 && response.text.trim()) {
    const retryInstructions = `${extractNewsletterLinksPrompt}\n\n【重要】上一次输出不是有效 JSON，请仅输出完整 JSON 数组，不要代码块或多余文字。`
    const retryResponse = await createResponseText({
      env,
      model,
      instructions: retryInstructions,
      input,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: newsletterLinkSchema,
    })
    if (rules?.debug) {
      console.info('newsletter ai retry response', {
        subject,
        messageId,
        receivedAt,
        provider,
        model,
        outputLength: retryResponse.text.length,
        finishReason: retryResponse.finishReason,
        output: retryResponse.text,
      })
    }
    rawCandidates = parseNewsletterLinks(retryResponse.text)
  }
  const trackingCache = new Map<string, string>()
  const resolveTrackingLinks = rules?.resolveTrackingLinks !== false
  let resolvedCount = 0
  let failedResolveCount = 0

  const normalizedCandidates = await Promise.all(rawCandidates.map(async (candidate) => {
    const normalizedLink = normalizeUrl(candidate.link)
    if (!normalizedLink) {
      return null
    }
    const { href, unwrapped } = unwrapTrackingUrl(normalizedLink)
    let resolved = href
    if (resolveTrackingLinks && !unwrapped) {
      const hostname = (() => {
        try {
          return new URL(href).hostname.toLowerCase()
        }
        catch {
          return ''
        }
      })()
      const isTrackingHost = trackingHostnames.some(keyword => hostname.includes(keyword))
      if (isTrackingHost) {
        resolved = await resolveTrackingRedirect(href, trackingCache)
        if (resolved !== href) {
          resolvedCount += 1
        }
        else {
          failedResolveCount += 1
        }
      }
    }
    return {
      title: candidate.title ? normalizeText(candidate.title) : undefined,
      link: resolved,
    }
  }))

  const filtered = normalizedCandidates.filter((candidate): candidate is NewsletterLinkCandidate => {
    if (!candidate?.link) {
      return false
    }
    try {
      return Boolean(new URL(candidate.link))
    }
    catch {
      return false
    }
  })

  const deduped = new Map<string, NewsletterLinkCandidate>()
  for (const candidate of filtered) {
    const key = getUrlKey(candidate.link)
    if (!deduped.has(key)) {
      deduped.set(key, candidate)
    }
  }

  const results = Array.from(deduped.values()).slice(0, MAX_NEWSLETTER_LINKS)

  if (rules?.debug) {
    console.info('newsletter ai link debug', {
      subject,
      messageId,
      receivedAt,
      inputLength: content.length,
      rawCount: rawCandidates.length,
      trackingResolved: resolvedCount,
      trackingResolveFailed: failedResolveCount,
      afterFilter: filtered.length,
      afterDedup: deduped.size,
      finalCount: results.length,
      provider,
      model,
    })
  }

  return results
}
