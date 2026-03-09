import process from 'node:process'
import { headers } from 'next/headers'
import { podcast } from '@/config'

const DEFAULT_BASE_URL = 'http://localhost:3000'

export function normalizeBaseUrl(value?: string | null): string {
  const candidate = value?.trim()
  if (!candidate) {
    return ''
  }

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return ''
    }
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  }
  catch {
    return ''
  }
}

export function getConfiguredBaseUrl(): string {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)
    || normalizeBaseUrl(podcast.base.link)
}

export async function resolveBaseUrlFromHeaders(): Promise<string> {
  const configuredBaseUrl = getConfiguredBaseUrl()
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  const headerStore = await headers()
  const forwardedHost = headerStore.get('x-forwarded-host') || headerStore.get('host') || ''
  const forwardedProto = headerStore.get('x-forwarded-proto') || 'https'
  const host = forwardedHost.split(',')[0]?.trim()
  const protocol = forwardedProto.split(',')[0]?.trim() || 'https'

  if (host) {
    const derivedBaseUrl = normalizeBaseUrl(`${protocol}://${host}`)
    if (derivedBaseUrl) {
      return derivedBaseUrl
    }
  }

  return DEFAULT_BASE_URL
}

export function resolveBaseUrlFromRequest(request: Request): string {
  return getConfiguredBaseUrl()
    || normalizeBaseUrl(new URL(request.url).origin)
    || DEFAULT_BASE_URL
}
