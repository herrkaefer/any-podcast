import type { AiEnv } from '../ai'
import type { SourceConfig } from './types'

import * as cheerio from 'cheerio'
import { $fetch } from 'ofetch'

import { getContentFromJinaWithRetry, isSubrequestLimitError } from '../utils'
import { extractNewsletterLinksWithAi } from './newsletter-links'

const NEWSLETTER_HOSTS = ['kill-the-newsletter.com']

interface RssEnv extends AiEnv {
  JINA_KEY?: string
  NODE_ENV?: string
}

function isNewsletterLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return NEWSLETTER_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`))
  }
  catch {
    return false
  }
}

interface RssItem {
  title: string
  link: string
  guid?: string
  pubDate?: string
}

function parseDate(dateText: string | undefined) {
  if (!dateText) {
    return null
  }
  const parsed = new Date(dateText)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(part => part.type === 'year')?.value || '0000'
  const month = parts.find(part => part.type === 'month')?.value || '01'
  const day = parts.find(part => part.type === 'day')?.value || '01'

  return `${year}-${month}-${day}`
}

function isWithinLookback(publishedAt: Date, now: Date, lookbackDays: number) {
  const windowStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
  return publishedAt >= windowStart && publishedAt <= now
}

function isSameDayInTimeZone(publishedAt: Date, now: Date, timeZone: string) {
  return getDateKeyInTimeZone(publishedAt, timeZone) === getDateKeyInTimeZone(now, timeZone)
}

function isWithinWindow(publishedAt: Date, start: Date, end: Date) {
  return publishedAt >= start && publishedAt <= end
}

function extractRssItems(xml: string) {
  const $ = cheerio.load(xml, { xmlMode: true })
  const items = $('item')
  return items.map((_, el) => {
    const title = $(el).find('title').first().text().trim()
    const link = $(el).find('link').first().text().trim()
    const guid = $(el).find('guid').first().text().trim()
    const pubDate = $(el).find('pubDate').first().text().trim()
    return { title, link, guid, pubDate } satisfies RssItem
  }).get()
}

function extractAtomItems(xml: string) {
  const $ = cheerio.load(xml, { xmlMode: true })
  const entries = $('entry')
  return entries.map((_, el) => {
    const title = $(el).find('title').first().text().trim()
    const linkEl = $(el).find('link[rel="alternate"]').first()
    const link = linkEl.attr('href')
      || $(el).find('link').first().attr('href')
      || $(el).find('link').first().text().trim()
    const guid = $(el).find('id').first().text().trim()
    const pubDate = $(el).find('published').first().text().trim()
      || $(el).find('updated').first().text().trim()
    return { title, link: link || '', guid, pubDate } satisfies RssItem
  }).get()
}

function normalizeItem(item: RssItem) {
  const url = item.link || item.guid || ''
  if (!url) {
    return null
  }
  return { ...item, link: url }
}

export async function fetchRssItems(
  source: SourceConfig,
  now: Date,
  lookbackDays: number,
  window?: { start: Date, end: Date, timeZone: string },
  env?: RssEnv,
) {
  const timeZone = 'America/Chicago'

  try {
    const xml = await $fetch<string>(source.url, {
      timeout: 30000,
      parseResponse: txt => txt,
    })

    const rssItems = extractRssItems(xml)
    const items = rssItems.length ? rssItems : extractAtomItems(xml)

    const filteredItems = items
      .map(normalizeItem)
      .filter((item): item is RssItem => Boolean(item))
      .filter((item) => {
        const publishedAt = parseDate(item.pubDate)
        if (!publishedAt) {
          console.warn('rss item missing pubDate', { source: source.name, title: item.title })
          return false
        }
        if (window) {
          return isWithinWindow(publishedAt, window.start, window.end)
        }
        return isSameDayInTimeZone(publishedAt, now, timeZone)
          && isWithinLookback(publishedAt, now, lookbackDays)
      })

    const stories: Story[] = []

    for (const item of filteredItems) {
      if (isNewsletterLink(item.link) && env) {
        try {
          const content = await getContentFromJinaWithRetry(item.link, 'markdown', {}, env.JINA_KEY)
          if (!content) {
            console.warn('rss newsletter content empty', { source: source.name, title: item.title, link: item.link })
            continue
          }
          const links = await extractNewsletterLinksWithAi({
            subject: item.title,
            content,
            source,
            env,
            messageId: item.guid || item.link,
            receivedAt: item.pubDate || now.toISOString(),
          })
          if (links.length === 0) {
            console.warn('rss newsletter no links extracted', { source: source.name, title: item.title })
            continue
          }
          console.info('rss newsletter links extracted', { source: source.name, title: item.title, count: links.length })
          for (const [index, link] of links.entries()) {
            stories.push({
              id: `${item.guid || item.link}:${index}`,
              title: link.title || item.title,
              url: link.link,
              sourceName: source.name,
              sourceUrl: source.url,
              publishedAt: item.pubDate,
              sourceItemId: item.guid || item.link,
              sourceItemTitle: item.title,
            })
          }
        }
        catch (error) {
          if (isSubrequestLimitError(error))
            throw error
          console.error('rss newsletter processing failed', { source: source.name, title: item.title, error })
        }
      }
      else {
        stories.push({
          id: item.guid || item.link,
          title: item.title,
          url: item.link,
          sourceName: source.name,
          sourceUrl: source.url,
          publishedAt: item.pubDate,
        })
      }
    }

    return stories
  }
  catch (error) {
    console.error('fetch rss items failed', { source: source.name, error })
    return []
  }
}
