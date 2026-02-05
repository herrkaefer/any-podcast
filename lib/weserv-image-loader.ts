/* eslint-disable node/prefer-global/process */
import type { ImageLoaderProps } from 'next/image'

const WSERV_BASE_ENDPOINT
  = (process.env.NEXT_PUBLIC_IMAGE_LOADER_BASE ?? 'https://images.weserv.nl/')
    .replace(/\/$/, '')

const DEFAULT_IMAGE_ORIGIN
  = process.env.NEXT_PUBLIC_IMAGE_ORIGIN
    ?? process.env.NEXT_PUBLIC_BASE_URL
    ?? 'http://localhost:3000'

function isDataLikeSource(src: string) {
  return src.startsWith('data:') || src.startsWith('blob:')
}

function resolveAbsoluteSrc(src: string): string {
  if (!src || isDataLikeSource(src)) {
    return src
  }

  if (/^https?:\/\//i.test(src)) {
    return src
  }

  if (src.startsWith('//')) {
    return `https:${src}`
  }

  const normalizedOrigin = DEFAULT_IMAGE_ORIGIN.endsWith('/')
    ? DEFAULT_IMAGE_ORIGIN.slice(0, -1)
    : DEFAULT_IMAGE_ORIGIN
  const normalizedPath = src.startsWith('/') ? src : `/${src}`

  return `${normalizedOrigin}${normalizedPath}`
}

export default function weservImageLoader({ src, width, quality }: ImageLoaderProps): string {
  if (!src || isDataLikeSource(src)) {
    return src
  }

  const absoluteSrc = resolveAbsoluteSrc(src)

  const endpoint = new URL(`${WSERV_BASE_ENDPOINT}/`)
  endpoint.searchParams.set('url', absoluteSrc)
  endpoint.searchParams.set('w', width.toString())

  if (quality) {
    endpoint.searchParams.set('q', quality.toString())
  }

  endpoint.searchParams.set('fit', 'inside')
  endpoint.searchParams.set('we', '1')

  return endpoint.toString()
}
