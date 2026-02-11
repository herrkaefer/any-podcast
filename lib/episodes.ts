import type { Episode } from '@/types/podcast'

function getEpisodeLabels(language?: string) {
  const normalized = (language || '').toLowerCase()
  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return {
      transcript: '播客全文',
      references: '参考链接',
    }
  }
  return {
    transcript: 'Podcast Transcript',
    references: 'References',
  }
}

function buildAudioUrl(staticHost: string, audioPath: string, updatedAt?: number) {
  const normalizedHost = staticHost?.replace(/\/$/, '')
  if (/^https?:\/\//.test(audioPath)) {
    return updatedAt ? `${audioPath}?t=${updatedAt}` : audioPath
  }
  const cleanedPath = audioPath.replace(/^\//, '')
  const base = `${normalizedHost}/${cleanedPath}`
  return updatedAt ? `${base}?t=${updatedAt}` : base
}

function getAudioMimeType(audioPath: string): string {
  const normalized = (audioPath || '').split('?')[0].toLowerCase()
  if (normalized.endsWith('.wav')) {
    return 'audio/wav'
  }
  if (normalized.endsWith('.ogg')) {
    return 'audio/ogg'
  }
  if (normalized.endsWith('.webm')) {
    return 'audio/webm'
  }
  return 'audio/mpeg'
}

function buildReferencesSection(stories: Story[] | undefined, referencesLabel: string): string {
  if (!stories || stories.length === 0) {
    return ''
  }

  const items = stories
    .map((story) => {
      const title = story.title || story.url || ''
      const href = story.url || '#'
      if (!title || !href)
        return null
      return `- [${title}](${href})`
    })
    .filter(Boolean)

  if (items.length === 0) {
    return ''
  }

  return [`## ${referencesLabel}`, ...items].join('\n')
}

export function buildEpisodeFromArticle(
  article: Article,
  staticHost: string,
  language?: string,
): Episode {
  const labels = getEpisodeLabels(language)
  const publishedIso = article.publishedAt
    || (typeof article.updatedAt === 'number' ? new Date(article.updatedAt).toISOString() : article.date)

  const normalizedTitle = article.title

  const description
    = article.introContent
      || article.podcastContent?.split('\n')?.[0]
      || article.blogContent?.split('\n')?.[0]
      || article.title

  const sections: string[] = []

  if (article.blogContent) {
    sections.push(article.blogContent)
  }

  if (article.podcastContent) {
    sections.push(`## ${labels.transcript}\n\n${article.podcastContent}`)
  }

  const references = buildReferencesSection(article.stories, labels.references)
  if (references) {
    sections.push(references)
  }

  return {
    id: article.date,
    title: normalizedTitle,
    description,
    content: sections.join('\n\n'),
    published: publishedIso,
    audio: {
      src: buildAudioUrl(staticHost, article.audio, article.updatedAt),
      type: getAudioMimeType(article.audio),
    },
    summary: article.introContent,
    stories: article.stories,
  }
}

export function buildEpisodesFromArticles(
  articles: Article[],
  staticHost: string,
  language?: string,
): Episode[] {
  return articles
    .map(article => buildEpisodeFromArticle(article, staticHost, language))
    .sort((a, b) => (a.published < b.published ? 1 : -1))
}
