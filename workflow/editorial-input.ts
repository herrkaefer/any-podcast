import { cleanArticleText } from './html-content'

export interface EditorialArticle {
  source: string
  title: string
  content: string
}

interface ArticleStory { title?: string, sourceName?: string }

export function createEditorialArticle(story: ArticleStory, body: string): EditorialArticle {
  const content = cleanArticleText(body)
  if (!content)
    throw new Error('Article body is empty after cleaning')
  return {
    source: cleanArticleText(story.sourceName || ''),
    title: cleanArticleText(story.title || ''),
    content,
  }
}

/** The model receives complete cleaned articles, with no URLs or private feed fields. */
export function buildPodcastStoryInput(articles: EditorialArticle[]) {
  if (!articles.length)
    throw new Error('No article bodies are available')
  const packet = { articles: articles.map(({ source, title, content }) => ({ source, title, content })) }
  if (packet.articles.some(article => !article.content.trim() || /https?:\/\//i.test(JSON.stringify(article))))
    throw new Error('Editorial article content must be nonempty and URL-free')
  return JSON.stringify(packet)
}

/** Add public citations after generation; article URLs never go to the model. */
export function linkArticleHeadings(markdown: string, stories: { title?: string, url?: string }[]) {
  const links = new Map(stories.filter(story => story.title && /^https?:\/\//.test(story.url || '')).map(story => [story.title!.trim(), story.url!]))
  return markdown.replace(/^## ([^\n]+)$/gm, (heading, title: string) => {
    const url = links.get(title.trim())
    return url ? `## [${title.trim().replace(/([[\]])/g, '\\$1')}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : heading
  })
}

/** Keep one copy of an article shared by several feeds, preserving meaningful queries. */
export function uniqueArticleStories<T extends { url?: string }>(stories: T[]): T[] {
  const seen = new Set<string>()
  return stories.filter((story) => {
    let key = story.url || ''
    try {
      const url = new URL(key)
      url.hash = ''
      for (const name of Array.from(url.searchParams.keys())) {
        if (/^utm_/i.test(name) || ['ecd', 'goal'].includes(name))
          url.searchParams.delete(name)
      }
      url.searchParams.sort()
      key = url.href
    }
    catch {}
    if (!key)
      return true
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}
