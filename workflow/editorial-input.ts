interface EditorialStory { title?: string, url?: string, link?: string, sourceName?: string }

/** Carry public provenance into script generation without private feed addresses. */
export function buildPodcastStoryInput(stories: EditorialStory[], summaries: string[]) {
  if (stories.length !== summaries.length)
    throw new Error('Story metadata and summaries must have the same length')
  return JSON.stringify({ stories: summaries.map((summary, i) => ({
    title: stories[i].title || '',
    publisher: stories[i].sourceName || '',
    url: stories[i].url || stories[i].link || '',
    summary: summary.replace(/^\s*<story>/, '').replace(/<\/story>\s*$/, '').trim(),
  })) })
}
