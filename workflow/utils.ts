import puppeteer from '@cloudflare/puppeteer'
import { $fetch } from 'ofetch'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getErrorStatus(error: unknown) {
  const err = error as { response?: { status?: number }, status?: number }
  return err?.response?.status ?? err?.status
}

function isTimeoutError(error: unknown) {
  const err = error as { name?: string, code?: string, cause?: { name?: string, code?: string }, message?: string }
  if (err?.name === 'TimeoutError' || err?.cause?.name === 'TimeoutError') {
    return true
  }
  if (err?.code === 'ETIMEDOUT' || err?.cause?.code === 'ETIMEDOUT') {
    return true
  }
  const message = err?.message?.toLowerCase() || ''
  return message.includes('timeout') || message.includes('timed out') || message.includes('aborted')
}

export function isSubrequestLimitError(error: unknown) {
  const message = (error as { message?: string })?.message || ''
  return message.includes('Too many subrequests') || message.includes('too many subrequests')
}

export async function getContentFromJinaWithRetry(
  url: string,
  format: 'html' | 'markdown',
  selector?: { include?: string, exclude?: string },
  JINA_KEY?: string,
  options?: { retryLimit?: number, retryDelayMs?: number },
) {
  const retryLimit = options?.retryLimit ?? 3
  let retryDelayMs = options?.retryDelayMs ?? 3000

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      return await getContentFromJina(url, format, selector, JINA_KEY)
    }
    catch (error) {
      // Subrequest limit is fatal — retrying in the same invocation is pointless
      if (isSubrequestLimitError(error)) {
        throw error
      }
      const status = getErrorStatus(error)
      const timeout = isTimeoutError(error)
      if ((status !== 429 && !timeout) || attempt >= retryLimit) {
        throw error
      }
      const reason = status === 429 ? 'rate limited (429)' : 'timeout'
      console.warn(`Jina ${reason}, retrying in ${retryDelayMs}ms`, { url, attempt: attempt + 1 })
      await sleep(retryDelayMs)
      retryDelayMs *= 2
    }
  }

  return ''
}

export async function getContentFromJina(url: string, format: 'html' | 'markdown', selector?: { include?: string, exclude?: string }, JINA_KEY?: string) {
  const jinaHeaders: HeadersInit = {
    'X-Retain-Images': 'none',
    'X-Return-Format': format,
  }

  if (JINA_KEY) {
    jinaHeaders.Authorization = `Bearer ${JINA_KEY}`
  }

  if (selector?.include) {
    jinaHeaders['X-Target-Selector'] = selector.include
  }

  if (selector?.exclude) {
    jinaHeaders['X-Remove-Selector'] = selector.exclude
  }

  console.info('get content from jina', url)
  const content = await $fetch(`https://r.jina.ai/${url}`, {
    headers: jinaHeaders,
    timeout: 30000,
    parseResponse: txt => txt,
  })
  return content
}

export async function getContentFromFirecrawl(url: string, format: 'html' | 'markdown', selector?: { include?: string, exclude?: string }, FIRECRAWL_KEY?: string) {
  if (!FIRECRAWL_KEY) {
    console.warn('FIRECRAWL_KEY is not configured, skip firecrawl', { url })
    return ''
  }

  const firecrawlHeaders: HeadersInit = {
    Authorization: `Bearer ${FIRECRAWL_KEY}`,
  }

  try {
    console.info('get content from firecrawl', url)
    const result = await $fetch<{ success: boolean, data: Record<string, string> }>('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: firecrawlHeaders,
      timeout: 30000,
      body: {
        url,
        formats: [format],
        onlyMainContent: true,
        includeTags: selector?.include ? [selector.include] : undefined,
        excludeTags: selector?.exclude ? [selector.exclude] : undefined,
      },
    })
    if (result.success) {
      return result.data[format] || ''
    }
    else {
      console.error(`get content from firecrawl failed: ${url} ${result}`)
      return ''
    }
  }
  catch (error: Error | any) {
    console.error(`get content from firecrawl failed: ${url} ${error}`, error.data)
    return ''
  }
}

export async function getStoryContent(story: Story, maxTokens: number, { JINA_KEY, FIRECRAWL_KEY }: { JINA_KEY?: string, FIRECRAWL_KEY?: string }) {
  if (!story.url) {
    throw new Error('story url is empty')
  }

  const storyUrl = story.url
  const article = await getContentFromJinaWithRetry(storyUrl, 'markdown', {}, JINA_KEY)
    .catch((error) => {
      if (isSubrequestLimitError(error))
        throw error
      console.error('getStoryContent from Jina failed', error)
      if (!FIRECRAWL_KEY) {
        return ''
      }
      return getContentFromFirecrawl(storyUrl, 'markdown', {}, FIRECRAWL_KEY)
    })

  return [
    story.title
      ? `
<title>
${story.title}
</title>
`
      : '',
    article
      ? `
<article>
${article.substring(0, maxTokens * 5)}
</article>
`
      : '',
  ].filter(Boolean).join('\n\n---\n\n')
}

export async function concatAudioFiles(
  audioFiles: string[],
  BROWSER: Fetcher,
  { workerUrl, audioQuality }: { workerUrl: string, audioQuality?: number },
) {
  // Rewrite external URLs to same-origin worker proxy to avoid COEP blocking
  const workerOrigin = new URL(workerUrl).origin
  const sameOriginFiles = audioFiles.map((url) => {
    if (url.startsWith('data:')) {
      return url
    }
    try {
      const u = new URL(url)
      if (u.origin !== workerOrigin) {
        return `${workerUrl}/static${u.pathname}${u.search}`
      }
    }
    catch {}
    return url
  })

  const browser = await puppeteer.launch(BROWSER)
  const page = await browser.newPage()
  await page.goto(`${workerUrl}/audio`)

  console.info('start concat audio files', sameOriginFiles)

  try {
    const fileUrl = await page.evaluate(async (audioFiles, quality) => {
      // 此处 JS 运行在浏览器中
      try {
        // @ts-expect-error 浏览器内的对象
        const blob = await concatAudioFilesOnBrowser(audioFiles, { audioQuality: quality })

        const result = new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        return { data: await result, error: null }
      }
      catch (err) {
        return {
          data: null,
          error: {
            message: (err as Error)?.message || String(err),
            name: (err as Error)?.name,
            audioFiles,
          },
        }
      }
    }, sameOriginFiles, audioQuality) as { data: string | null, error: { message: string, name?: string, audioFiles: string[] } | null }

    if (fileUrl.error) {
      throw new Error(`Browser FFmpeg failed: ${fileUrl.error.message} (files: ${fileUrl.error.audioFiles.join(', ')})`)
    }

    console.info('concat audio files result', fileUrl.data!.substring(0, 100))

    await browser.close()

    const response = await fetch(fileUrl.data!)
    return await response.blob()
  }
  catch (error) {
    await browser.close().catch(() => {})
    console.error('concatAudioFiles failed', {
      files: sameOriginFiles,
      error: (error as Error)?.message || String(error),
    })
    throw error
  }
}

export async function addIntroMusic(
  podcastAudioUrl: string,
  BROWSER: Fetcher,
  options: {
    workerUrl: string
    themeUrl?: string
    fadeOutStart?: number
    fadeOutDuration?: number
    podcastDelayMs?: number
    audioQuality?: number
  },
) {
  const {
    workerUrl,
    themeUrl: customThemeUrl,
    fadeOutStart,
    fadeOutDuration,
    podcastDelayMs,
    audioQuality,
  } = options
  // Rewrite external URL to same-origin worker proxy to avoid COEP blocking
  const workerOrigin = new URL(workerUrl).origin
  let sameOriginPodcastUrl = podcastAudioUrl
  if (!podcastAudioUrl.startsWith('data:')) {
    try {
      const u = new URL(podcastAudioUrl)
      if (u.origin !== workerOrigin) {
        sameOriginPodcastUrl = `${workerUrl}/static${u.pathname}${u.search}`
      }
    }
    catch {}
  }

  const themeUrl = customThemeUrl || `${workerUrl}/theme.mp3`

  const browser = await puppeteer.launch(BROWSER)
  const page = await browser.newPage()
  await page.goto(`${workerUrl}/audio`)

  console.info('start add intro music', { podcastUrl: sameOriginPodcastUrl, themeUrl })

  try {
    const fileUrl = await page.evaluate(async (
      podcastUrl,
      themeAudioUrl,
      mixOptions,
    ) => {
      try {
        // @ts-expect-error 浏览器内的对象
        const blob = await addIntroMusicOnBrowser(podcastUrl, themeAudioUrl, mixOptions)

        const result = new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        return { data: await result, error: null }
      }
      catch (err) {
        return {
          data: null,
          error: {
            message: (err as Error)?.message || String(err),
            name: (err as Error)?.name,
          },
        }
      }
    }, sameOriginPodcastUrl, themeUrl, {
      fadeOutStart,
      fadeOutDuration,
      podcastDelayMs,
      audioQuality,
    }) as { data: string | null, error: { message: string, name?: string } | null }

    if (fileUrl.error) {
      throw new Error(`Browser FFmpeg addIntroMusic failed: ${fileUrl.error.message}`)
    }

    console.info('add intro music result', fileUrl.data!.substring(0, 100))

    await browser.close()

    const response = await fetch(fileUrl.data!)
    return await response.blob()
  }
  catch (error) {
    await browser.close().catch(() => {})
    console.error('addIntroMusic failed', {
      podcastUrl: sameOriginPodcastUrl,
      error: (error as Error)?.message || String(error),
    })
    throw error
  }
}
