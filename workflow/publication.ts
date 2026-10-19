export type PublicationMode = 'publish' | 'preview'

export function resolvePublicationMode(environment: string | undefined, requestedPublish?: boolean, checkpointMode?: PublicationMode): PublicationMode {
  const mode = environment?.trim().toLowerCase()
  if (mode && mode !== 'preview' && mode !== 'publish')
    throw new Error('PODCAST_PUBLISH_MODE must be preview or publish')
  if (mode === 'preview' || requestedPublish === false || checkpointMode === 'preview')
    return 'preview'
  return 'publish'
}

export function previewEpisodeKey(jobId: string) {
  return `previews/${jobId}/episode.json`
}

export function episodeAudioKey(mode: PublicationMode, jobId: string, publishedKey: string) {
  return mode === 'preview' ? `previews/${jobId}/podcast.mp3` : publishedKey
}

export async function saveEpisodeOutput(
  env: { PODCAST_KV: KVNamespace, PODCAST_R2: R2Bucket },
  mode: PublicationMode,
  jobId: string,
  contentKey: string,
  episode: unknown,
) {
  const body = JSON.stringify(episode)
  if (mode === 'preview') {
    await env.PODCAST_R2.put(previewEpisodeKey(jobId), body, { httpMetadata: { contentType: 'application/json' } })
  }
  else {
    await env.PODCAST_KV.put(contentKey, body)
  }
}
