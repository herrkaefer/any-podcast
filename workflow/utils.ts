import puppeteer from '@cloudflare/puppeteer'
import { $fetch } from 'ofetch'

interface SelectorOptions {
  include?: string
  exclude?: string
}

interface CloudflareMarkdownEnv {
  CLOUDFLARE_ANYPODCAST_ACCOUNT_ID?: string
  CLOUDFLARE_ANYPODCAST_API_TOKEN?: string
}

interface JinaEnv {
  JINA_KEY?: string
}

interface FirecrawlEnv {
  FIRECRAWL_KEY?: string
}

interface CloudflareMarkdownResponse {
  success: boolean
  result?: string
  errors?: Array<string | { message?: string }>
  messages?: Array<string | { message?: string }>
}

interface CloudflareToMarkdownItem {
  name: string
  mimeType: string
  format: 'markdown' | 'error'
  tokens?: number | null
  data?: string
  error?: string | null
}

interface CloudflareToMarkdownResponse {
  success: boolean
  result?: CloudflareToMarkdownItem[]
  errors?: Array<string | { message?: string }>
  messages?: Array<string | { message?: string }>
}

interface SupportedDocumentFormat {
  extension: string
  mimeType: string
}

const SUPPORTED_DOCUMENT_FORMATS = new Map<string, SupportedDocumentFormat>([
  ['pdf', { extension: 'pdf', mimeType: 'application/pdf' }],
  ['jpeg', { extension: 'jpeg', mimeType: 'image/jpeg' }],
  ['png', { extension: 'png', mimeType: 'image/png' }],
  ['webp', { extension: 'webp', mimeType: 'image/webp' }],
  ['svg', { extension: 'svg', mimeType: 'image/svg+xml' }],
  ['html', { extension: 'html', mimeType: 'text/html' }],
  ['xml', { extension: 'xml', mimeType: 'application/xml' }],
  ['csv', { extension: 'csv', mimeType: 'text/csv' }],
  ['docx', { extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
  ['xlsx', { extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
  ['xlsm', { extension: 'xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' }],
  ['xlsb', { extension: 'xlsb', mimeType: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12' }],
  ['xls', { extension: 'xls', mimeType: 'application/vnd.ms-excel' }],
  ['et', { extension: 'et', mimeType: 'application/vnd.ms-excel' }],
  ['ods', { extension: 'ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' }],
  ['odt', { extension: 'odt', mimeType: 'application/vnd.oasis.opendocument.text' }],
  ['numbers', { extension: 'numbers', mimeType: 'application/vnd.apple.numbers' }],
])

const EXTENSION_ALIASES = new Map<string, string>([
  ['jpg', 'jpeg'],
  ['htm', 'html'],
])

const MIME_TYPE_ALIASES = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['text/html', 'html'],
  ['application/xhtml+xml', 'html'],
  ['application/xml', 'xml'],
  ['text/xml', 'xml'],
  ['text/csv', 'csv'],
  ['application/csv', 'csv'],
  ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.ms-excel.sheet.macroenabled.12', 'xlsm'],
  ['application/vnd.ms-excel.sheet.binary.macroenabled.12', 'xlsb'],
  ['application/x-iwork-numbers-sffnumbers', 'numbers'],
  ['application/vnd.apple.numbers', 'numbers'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  ['application/vnd.oasis.opendocument.text', 'odt'],
])

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

function normalizeCloudflareCredentials(accountId?: string, apiToken?: string) {
  const normalizedAccountId = accountId?.trim() || ''
  const normalizedApiToken = apiToken?.trim() || ''
  if (!normalizedAccountId || !normalizedApiToken) {
    return null
  }
  return { accountId: normalizedAccountId, apiToken: normalizedApiToken }
}

function isSelectorOptionsEmpty(selector?: SelectorOptions) {
  return !selector?.include && !selector?.exclude
}

function extractApiMessages(payload: { errors?: Array<string | { message?: string }>, messages?: Array<string | { message?: string }> }) {
  const values: string[] = []
  for (const entries of [payload.errors, payload.messages]) {
    if (!Array.isArray(entries)) {
      continue
    }
    for (const item of entries) {
      if (typeof item === 'string') {
        values.push(item)
      }
      else if (typeof item?.message === 'string') {
        values.push(item.message)
      }
    }
  }
  return values
}

function createHttpError(status: number, body: string) {
  const error = new Error(`HTTP error ${status}: ${body}`) as Error & { status: number }
  error.status = status
  return error
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  }
  finally {
    clearTimeout(timeout)
  }
}

function getSupportedFormatFromFilename(filename: string): SupportedDocumentFormat | null {
  const pathname = filename.split('?')[0] || filename
  const ext = pathname.split('.').pop()?.trim().toLowerCase() || ''
  if (!ext) {
    return null
  }
  const normalizedExtension = EXTENSION_ALIASES.get(ext) || ext
  return SUPPORTED_DOCUMENT_FORMATS.get(normalizedExtension) || null
}

function getSupportedFormatFromMimeType(mimeType: string): SupportedDocumentFormat | null {
  const normalizedMimeType = mimeType.toLowerCase().split(';', 1)[0]?.trim() || ''
  if (!normalizedMimeType) {
    return null
  }
  const normalizedExtension = MIME_TYPE_ALIASES.get(normalizedMimeType)
  if (!normalizedExtension) {
    return null
  }
  return SUPPORTED_DOCUMENT_FORMATS.get(normalizedExtension) || null
}

function inferFilename(url: string, response: Response) {
  const pathname = new URL(url).pathname
  const candidate = pathname.split('/').pop() || ''
  if (candidate && getSupportedFormatFromFilename(candidate)) {
    return candidate
  }

  const byMimeType = getSupportedFormatFromMimeType(response.headers.get('content-type') || '')
  if (byMimeType) {
    return `downloaded.${byMimeType.extension}`
  }

  return candidate || 'downloaded'
}

function looksLikeSupportedDocumentUrl(url: string) {
  try {
    const pathname = new URL(url).pathname
    const candidate = pathname.split('/').pop() || ''
    return Boolean(candidate && getSupportedFormatFromFilename(candidate))
  }
  catch {
    return false
  }
}

async function getContentFromCloudflareDocumentUrl(
  url: string,
  credentials: { accountId: string, apiToken: string },
) {
  console.info('get content from cloudflare toMarkdown', { url })
  const downloadResponse = await fetchWithTimeout(url, {}, 30000)
  if (!downloadResponse.ok) {
    throw createHttpError(downloadResponse.status, await downloadResponse.text())
  }

  const filename = inferFilename(url, downloadResponse)
  const format = getSupportedFormatFromFilename(filename)
  if (!format) {
    throw new Error(`Unsupported Cloudflare document format for URL: ${url}`)
  }

  const bytes = await downloadResponse.arrayBuffer()
  const formData = new FormData()
  formData.append('files', new File([bytes], filename, { type: format.mimeType }))

  const result = await $fetch<CloudflareToMarkdownResponse>(
    `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/tomarkdown`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiToken}`,
      },
      timeout: 30000,
      body: formData,
    },
  )

  if (!result.success) {
    throw new Error(extractApiMessages(result).join('; ') || 'Cloudflare toMarkdown failed')
  }

  const item = result.result?.[0]
  if (!item) {
    throw new Error('Cloudflare toMarkdown returned an empty result')
  }
  if (item.format === 'error') {
    throw new Error(item.error || `Cloudflare toMarkdown failed for ${filename}`)
  }
  return item.data || ''
}

async function getContentFromCloudflareWebUrl(
  url: string,
  credentials: { accountId: string, apiToken: string },
) {
  try {
    const markdownForAgentsResponse = await fetchWithTimeout(url, {
      headers: {
        Accept: 'text/markdown',
      },
    }, 30000)
    const contentType = (markdownForAgentsResponse.headers.get('content-type') || '').toLowerCase()
    if (markdownForAgentsResponse.ok && contentType.includes('text/markdown')) {
      console.info('get content from markdown-for-agents', { url })
      return await markdownForAgentsResponse.text()
    }
  }
  catch (error) {
    console.warn('markdown-for-agents failed, fallback to browser-rendering', { url, error })
  }

  console.info('get content from cloudflare browser-rendering markdown', { url })
  const result = await $fetch<CloudflareMarkdownResponse>(
    `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/browser-rendering/markdown`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiToken}`,
      },
      timeout: 30000,
      body: { url },
    },
  )

  if (!result.success) {
    throw new Error(extractApiMessages(result).join('; ') || 'Cloudflare browser rendering markdown failed')
  }

  if (typeof result.result !== 'string') {
    throw new TypeError('Cloudflare browser rendering markdown returned an invalid response')
  }

  return result.result
}

export async function getContentFromCloudflare(
  url: string,
  format: 'html' | 'markdown',
  selector?: SelectorOptions,
  CLOUDFLARE_ANYPODCAST_ACCOUNT_ID?: string,
  CLOUDFLARE_ANYPODCAST_API_TOKEN?: string,
) {
  const credentials = normalizeCloudflareCredentials(CLOUDFLARE_ANYPODCAST_ACCOUNT_ID, CLOUDFLARE_ANYPODCAST_API_TOKEN)
  if (!credentials) {
    console.warn('cloudflare markdown credentials are not configured, skip cloudflare extraction', { url })
    return ''
  }

  if (format !== 'markdown') {
    console.warn('cloudflare extraction only supports markdown output, skip cloudflare extraction', { url, format })
    return ''
  }

  if (!isSelectorOptionsEmpty(selector)) {
    console.warn('cloudflare extraction does not support selector-based extraction, skip cloudflare extraction', { url, selector })
    return ''
  }

  if (looksLikeSupportedDocumentUrl(url)) {
    return getContentFromCloudflareDocumentUrl(url, credentials)
  }

  return getContentFromCloudflareWebUrl(url, credentials)
}

export async function getContentFromCloudflareWithRetry(
  url: string,
  format: 'html' | 'markdown',
  selector?: SelectorOptions,
  CLOUDFLARE_ANYPODCAST_ACCOUNT_ID?: string,
  CLOUDFLARE_ANYPODCAST_API_TOKEN?: string,
  options?: { retryLimit?: number, retryDelayMs?: number },
) {
  const retryLimit = options?.retryLimit ?? 2
  let retryDelayMs = options?.retryDelayMs ?? 2000

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      return await getContentFromCloudflare(url, format, selector, CLOUDFLARE_ANYPODCAST_ACCOUNT_ID, CLOUDFLARE_ANYPODCAST_API_TOKEN)
    }
    catch (error) {
      if (isSubrequestLimitError(error)) {
        throw error
      }
      const status = getErrorStatus(error)
      const timeout = isTimeoutError(error)
      const shouldRetry = status === 429 || (typeof status === 'number' && status >= 500) || timeout
      if (!shouldRetry || attempt >= retryLimit) {
        throw error
      }
      let reason = `server error (${status})`
      if (status === 429) {
        reason = 'rate limited (429)'
      }
      else if (timeout) {
        reason = 'timeout'
      }
      console.warn(`Cloudflare markdown ${reason}, retrying in ${retryDelayMs}ms`, { url, attempt: attempt + 1 })
      await sleep(retryDelayMs)
      retryDelayMs *= 2
    }
  }

  return ''
}

export async function getContentFromJinaWithRetry(
  url: string,
  format: 'html' | 'markdown',
  selector?: SelectorOptions,
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

export async function getContentFromJina(url: string, format: 'html' | 'markdown', selector?: SelectorOptions, JINA_KEY?: string) {
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

export async function getContentFromCloudflareWithJinaFallback(
  url: string,
  format: 'html' | 'markdown',
  selector: SelectorOptions | undefined,
  env: CloudflareMarkdownEnv & JinaEnv,
  options?: {
    cloudflare?: { retryLimit?: number, retryDelayMs?: number }
    jina?: { retryLimit?: number, retryDelayMs?: number }
  },
) {
  try {
    const content = await getContentFromCloudflareWithRetry(
      url,
      format,
      selector,
      env.CLOUDFLARE_ANYPODCAST_ACCOUNT_ID,
      env.CLOUDFLARE_ANYPODCAST_API_TOKEN,
      options?.cloudflare,
    )
    if (content) {
      return content
    }
  }
  catch (error) {
    if (isSubrequestLimitError(error)) {
      throw error
    }
    console.warn('cloudflare markdown extraction failed, fallback to jina', { url, error })
  }

  return getContentFromJinaWithRetry(url, format, selector, env.JINA_KEY, options?.jina)
}

export async function getContentFromFirecrawl(url: string, format: 'html' | 'markdown', selector?: SelectorOptions, FIRECRAWL_KEY?: string) {
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

export async function getStoryContent(
  story: Story,
  maxTokens: number,
  env: CloudflareMarkdownEnv & JinaEnv & FirecrawlEnv,
) {
  if (!story.url) {
    throw new Error('story url is empty')
  }

  const storyUrl = story.url
  const article = await getContentFromCloudflareWithJinaFallback(storyUrl, 'markdown', {}, env)
    .catch((error) => {
      if (isSubrequestLimitError(error))
        throw error
      console.error('getStoryContent from Cloudflare/Jina failed', error)
      if (!env.FIRECRAWL_KEY) {
        return ''
      }
      return getContentFromFirecrawl(storyUrl, 'markdown', {}, env.FIRECRAWL_KEY)
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
