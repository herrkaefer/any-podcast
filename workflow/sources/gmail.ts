import type { AiEnv } from '../ai'
import type { SourceConfig } from './types'

import { Buffer } from 'node:buffer'
import * as cheerio from 'cheerio'
import { $fetch } from 'ofetch'

import { getDateKeyInTimeZone, zonedTimeToUtc } from '../timezone'
import { getContentFromJinaWithRetry, isSubrequestLimitError } from '../utils'
import { extractNewsletterLinksWithAi, normalizeText, unwrapTrackingUrl } from './newsletter-links'

interface GmailAccessTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

interface GmailMessageListResponse {
  messages?: { id: string }[]
}

interface GmailMessageHeader {
  name: string
  value: string
}

interface GmailMessagePartBody {
  data?: string
  size?: number
}

interface GmailMessagePart {
  mimeType?: string
  filename?: string
  headers?: GmailMessageHeader[]
  body?: GmailMessagePartBody
  parts?: GmailMessagePart[]
}

interface GmailMessage {
  id: string
  internalDate?: string
  payload?: GmailMessagePart
}

interface GmailEnv extends AiEnv {
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
  GMAIL_USER_EMAIL?: string
  JINA_KEY?: string
  NODE_ENV?: string
}

export interface GmailMessageRef {
  id: string
  source: SourceConfig
  lookbackDays: number
  subject?: string
  receivedAt?: string
}

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function getHeader(headers: GmailMessageHeader[] | undefined, name: string) {
  if (!headers) {
    return ''
  }
  const found = headers.find(header => header.name.toLowerCase() === name.toLowerCase())
  return found?.value || ''
}

function findPartByMimeType(part: GmailMessagePart | undefined, mimeType: string): GmailMessagePart | null {
  if (!part) {
    return null
  }
  if (part.mimeType === mimeType) {
    return part
  }
  if (!part.parts) {
    return null
  }
  for (const child of part.parts) {
    const result = findPartByMimeType(child, mimeType)
    if (result) {
      return result
    }
  }
  return null
}

function extractHtml(message: GmailMessage) {
  const payload = message.payload
  if (!payload) {
    return ''
  }

  const htmlPart = findPartByMimeType(payload, 'text/html')
  if (htmlPart?.body?.data) {
    return decodeBase64Url(htmlPart.body.data)
  }

  const textPart = findPartByMimeType(payload, 'text/plain')
  if (textPart?.body?.data) {
    return decodeBase64Url(textPart.body.data)
  }

  return ''
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const defaultArchiveLinkKeywords = [
  'in your browser',
  'in a browser',
  'in browser',
]

function getYesterdayRangeInTimeZone(now: Date, timeZone: string) {
  const yesterday = new Date(now.getTime() - ONE_DAY_MS)
  const dateKey = getDateKeyInTimeZone(yesterday, timeZone)
  const startUtc = zonedTimeToUtc(dateKey, timeZone, 0, 0, 0)
  const endUtc = zonedTimeToUtc(dateKey, timeZone, 23, 59, 59)
  return { dateKey, startUtc, endUtc }
}

function findArchiveLink(html: string, keywords: string[]) {
  const $ = cheerio.load(html)
  const anchors = $('a[href]').map((_, el) => {
    const rawHref = $(el).attr('href')?.trim() || ''
    const text = normalizeText($(el).text()).toLowerCase()
    return { rawHref, text }
  }).get()

  const match = anchors.find(anchor =>
    anchor.text && keywords.some(keyword => anchor.text.includes(keyword)),
  )

  if (!match?.rawHref) {
    return ''
  }

  const { href } = unwrapTrackingUrl(match.rawHref)
  return href
}

function cleanNewsletterHtml(html: string): string {
  const $ = cheerio.load(html)
  $('style, script, svg, img, meta, link, head, noscript').remove()

  // 把 <a> 转成 markdown 格式，保留链接与上下文的关联
  $('a[href]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href') || ''
    const text = $el.text().trim()
    if (href.startsWith('http') && text) {
      $el.replaceWith(`[${text}](${href})`)
    }
  })

  // 用换行分隔块级元素，保留文档结构
  $('h1, h2, h3, h4, h5, h6, p, div, tr, li, br, hr').each((_, el) => {
    $(el).prepend('\n')
  })

  return $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim()
}

async function fetchAccessToken(env: GmailEnv) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail env vars are not configured')
  }

  const response = await $fetch<GmailAccessTokenResponse>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })

  return response.access_token
}

function buildGmailQuery(label: string, start: Date, end: Date) {
  // Gmail after:/before: 时间过滤存在已知精度问题，向外各扩一天确保不漏
  const paddedStart = new Date(start.getTime() - ONE_DAY_MS)
  const paddedEnd = new Date(end.getTime() + ONE_DAY_MS)
  const startSec = Math.floor(paddedStart.getTime() / 1000)
  const endSec = Math.floor(paddedEnd.getTime() / 1000)
  return `label:"${label}" after:${startSec} before:${endSec}`
}

async function listMessages(userId: string, query: string, maxResults: number, token: string) {
  const result = await $fetch<GmailMessageListResponse>(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    query: {
      q: query,
      maxResults,
    },
  })
  return result.messages ?? []
}

async function getMessage(userId: string, id: string, token: string) {
  return await $fetch<GmailMessage>(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    query: {
      format: 'full',
    },
  })
}

export async function listGmailMessageRefs(
  source: SourceConfig,
  now: Date,
  lookbackDays: number,
  env: GmailEnv,
  window?: { start: Date, end: Date, timeZone: string },
  runtimeOptions?: {
    timeZone?: string
  },
) {
  if (!source.label) {
    console.warn('gmail source missing label', source)
    return [] as GmailMessageRef[]
  }

  const userId = env.GMAIL_USER_EMAIL || 'me'
  const token = await fetchAccessToken(env)
  const timeZone = runtimeOptions?.timeZone || 'America/Chicago'
  const { startUtc, endUtc } = getYesterdayRangeInTimeZone(now, timeZone)
  const windowStart = window?.start || startUtc || new Date(now.getTime() - Math.max(lookbackDays, 2) * ONE_DAY_MS)
  const windowEnd = window?.end || endUtc || now
  const query = buildGmailQuery(source.label, windowStart, windowEnd)
  let maxMessages = source.maxMessages || 50
  if (env.NODE_ENV && env.NODE_ENV !== 'production') {
    maxMessages = Math.min(maxMessages, 3)
  }

  console.info('gmail list messages', {
    label: source.label,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    maxMessages,
  })

  const messageRefs = await listMessages(userId, query, maxMessages, token)

  const refs = await Promise.all(messageRefs.map(async (ref) => {
    const meta = await $fetch<GmailMessage>(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${ref.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      query: { format: 'metadata', metadataHeaders: 'Subject' },
    })
    const subject = getHeader(meta.payload?.headers, 'Subject')
    const receivedAt = meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : ''
    return {
      id: ref.id,
      source,
      lookbackDays,
      subject,
      receivedAt,
    }
  }))

  const filtered = refs.filter((ref) => {
    if (!ref.receivedAt)
      return false
    const t = new Date(ref.receivedAt)
    if (t < windowStart || t > windowEnd) {
      console.info('gmail message filtered out by time window', { id: ref.id, subject: ref.subject, receivedAt: ref.receivedAt })
      return false
    }
    return true
  })

  return filtered
}

export async function processGmailMessage(params: {
  messageId: string
  source: SourceConfig
  now: Date
  lookbackDays: number
  env: GmailEnv
  window?: { start: Date, end: Date, timeZone: string }
  timeZone?: string
  archiveLinkKeywords?: string[]
  extractNewsletterLinksPrompt?: string
}) {
  const {
    messageId,
    source,
    now,
    lookbackDays,
    env,
    window,
    archiveLinkKeywords = defaultArchiveLinkKeywords,
  } = params
  const timeZone = params.timeZone || 'America/Chicago'
  const userId = env.GMAIL_USER_EMAIL || 'me'
  const token = await fetchAccessToken(env)
  const { dateKey: targetDateKey, startUtc, endUtc } = getYesterdayRangeInTimeZone(now, timeZone)
  const windowStart = window?.start || startUtc || new Date(now.getTime() - Math.max(lookbackDays, 2) * ONE_DAY_MS)
  const windowEnd = window?.end || endUtc || now

  console.info('process gmail message', {
    id: messageId,
    source: source.name,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  })

  const message = await getMessage(userId, messageId, token)
  const html = extractHtml(message)
  if (!html) {
    console.warn('gmail message missing html body', { id: message.id })
    return [] as Story[]
  }

  const subject = getHeader(message.payload?.headers, 'Subject')
  const receivedAt = message.internalDate ? new Date(Number(message.internalDate)) : now
  const receivedAtIso = receivedAt.toISOString()
  console.info('gmail message loaded', {
    id: message.id,
    subject,
    receivedAt: receivedAtIso,
    htmlLength: html.length,
  })
  if (receivedAt < windowStart || receivedAt > windowEnd) {
    return [] as Story[]
  }

  if (!window) {
    const receivedDateKey = getDateKeyInTimeZone(receivedAt, timeZone)
    if (receivedDateKey !== targetDateKey) {
      return [] as Story[]
    }
  }

  const archiveLink = findArchiveLink(html, archiveLinkKeywords.map(keyword => keyword.toLowerCase()))
  let newsletterContent = ''
  if (archiveLink) {
    console.info('newsletter archive link found', { id: message.id, subject, receivedAt: receivedAtIso, archiveLink })
    try {
      newsletterContent = await getContentFromJinaWithRetry(archiveLink, 'markdown', {}, env.JINA_KEY)
    }
    catch (error) {
      if (isSubrequestLimitError(error))
        throw error
      console.warn('newsletter archive jina failed', { error, id: message.id, subject, receivedAt: receivedAtIso, archiveLink })
    }

    if (!newsletterContent) {
      console.warn('newsletter archive content is empty, skip message', { id: message.id, subject, receivedAt: receivedAtIso, archiveLink })
      return [] as Story[]
    }
  }
  else {
    console.info('newsletter missing archive link, cleaning html with turndown', { id: message.id, subject, receivedAt: receivedAtIso, rawHtmlLength: html.length })
    newsletterContent = cleanNewsletterHtml(html)
    console.info('newsletter html cleaned', { id: message.id, subject, receivedAt: receivedAtIso, cleanedLength: newsletterContent.length, reduction: `${Math.round((1 - newsletterContent.length / html.length) * 100)}%` })
    if (env.NODE_ENV && env.NODE_ENV !== 'production') {
      console.info('newsletter cleaned content preview', { id: message.id, content: newsletterContent.substring(0, 2000) })
    }
  }

  if (!newsletterContent) {
    console.warn('newsletter content is empty, skip message', { id: message.id, subject, receivedAt: receivedAtIso })
    return [] as Story[]
  }
  console.info('newsletter content prepared', {
    id: message.id,
    subject,
    receivedAt: receivedAtIso,
    length: newsletterContent.length,
  })

  try {
    const links = await extractNewsletterLinksWithAi({
      subject,
      content: newsletterContent,
      source,
      env,
      messageId: message.id,
      receivedAt: receivedAtIso,
      prompt: params.extractNewsletterLinksPrompt,
    })
    if (links.length === 0) {
      console.warn('newsletter has no matching links', { id: message.id, subject, receivedAt: receivedAtIso })
      return [] as Story[]
    }
    console.info('newsletter links extracted', { id: message.id, subject, receivedAt: receivedAtIso, count: links.length })
    return links.map((link, index) => ({
      id: `${message.id}:${index}`,
      title: link.title || subject,
      url: link.link,
      sourceName: source.name,
      sourceUrl: source.url,
      publishedAt: receivedAt.toISOString(),
      sourceItemId: message.id,
      sourceItemTitle: subject,
    }))
  }
  catch (error) {
    console.warn('newsletter ai extraction failed, skip message', { error, id: message.id, subject, receivedAt: receivedAtIso })
  }

  return [] as Story[]
}
