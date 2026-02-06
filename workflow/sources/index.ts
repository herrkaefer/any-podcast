import type { GmailMessageRef } from './gmail'

import type { SourceConfig } from './types'
import { loadSourceConfig } from './config'

import { listGmailMessageRefs } from './gmail'
import { fetchRssItems } from './rss'

export { processGmailMessage } from './gmail'
export type { GmailMessageRef } from './gmail'

function isEnabled(source: SourceConfig) {
  return source.enabled !== false
}

function getLookbackDays(source: SourceConfig, defaultLookbackDays: number) {
  return source.lookbackDays ?? defaultLookbackDays
}

export interface StoryCandidates {
  stories: Story[]
  gmailMessages: GmailMessageRef[]
}

export async function getStoryCandidatesFromSources(options?: { now?: Date, env?: CloudflareEnv, window?: { start: Date, end: Date, timeZone: string } }) {
  const now = options?.now ?? new Date()
  const { sources, lookbackDays } = await loadSourceConfig()
  const enabledSources = sources.filter(isEnabled)

  const groups = await Promise.all(
    enabledSources.map(async (source) => {
      const days = getLookbackDays(source, lookbackDays)
      switch (source.type) {
        case 'rss': {
          return {
            stories: await fetchRssItems(source, now, days, options?.window),
            gmailMessages: [] as GmailMessageRef[],
          }
        }
        case 'gmail': {
          if (!options?.env) {
            console.warn('gmail source requires env, skip', source)
            return { stories: [] as Story[], gmailMessages: [] as GmailMessageRef[] }
          }
          return {
            stories: [] as Story[],
            gmailMessages: await listGmailMessageRefs(source, now, days, options.env, options?.window),
          }
        }
        case 'url':
          return {
            stories: [
              {
                id: source.id,
                title: source.name,
                url: source.url,
                sourceName: source.name,
                sourceUrl: source.url,
              },
            ],
            gmailMessages: [] as GmailMessageRef[],
          }
        default:
          console.warn('unknown source type', source)
          return { stories: [] as Story[], gmailMessages: [] as GmailMessageRef[] }
      }
    }),
  )

  return groups.reduce<StoryCandidates>((acc, group) => {
    acc.stories.push(...group.stories)
    acc.gmailMessages.push(...group.gmailMessages)
    return acc
  }, { stories: [], gmailMessages: [] })
}
