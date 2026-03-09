import type { Metadata } from 'next'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { Providers } from '@/components/providers'
import { site } from '@/config'
import { toLocale } from '@/i18n/config'
import { getActiveRuntimeConfig } from '@/lib/runtime-config'
import { resolveBaseUrlFromHeaders } from '@/lib/site-url'
import './globals.css'
import '@vidstack/react/player/styles/base.css'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/audio.css'

const themeInitializer = `
  (function() {
    try {
      const theme = localStorage.getItem('next-ui-theme') || 'system'
      const root = document.documentElement
      root.classList.remove('light', 'dark')

      if (theme === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        root.classList.add(systemTheme)
      }
      else {
        root.classList.add(theme)
      }
    }
    catch (error) {
      console.error('Failed to initialize theme', error)
    }
  })()
`

export async function generateMetadata(): Promise<Metadata> {
  const { env } = await getCloudflareContext({ async: true })
  const layoutEnv = env as LayoutEnv
  const runtimeConfig = await getActiveRuntimeConfig(layoutEnv)
  const title = runtimeConfig.config.site.title || site.seo.defaultTitle
  const description = runtimeConfig.config.site.description || site.seo.defaultDescription
  const baseUrl = await resolveBaseUrlFromHeaders()

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: `%s · ${title}`,
    },
    description,
    alternates: {
      canonical: '/',
      types: {
        'application/rss+xml': [
          {
            url: '/rss.xml',
            title,
          },
        ],
      },
    },
    openGraph: {
      title,
      description,
      url: baseUrl,
      type: 'website',
      images: [
        {
          url: site.seo.defaultImage,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      site: site.seo.twitterHandle,
      title,
      description,
      images: [site.seo.defaultImage],
    },
    robots: {
      index: true,
      follow: true,
    },
    icons: {
      icon: site.favicon,
    },
  }
}

interface LayoutEnv extends CloudflareEnv {
  PODCAST_KV: KVNamespace
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { env } = await getCloudflareContext({ async: true })
  const layoutEnv = env as LayoutEnv
  const runtimeConfig = await getActiveRuntimeConfig(layoutEnv)
  const runtimeSite = runtimeConfig.config.site
  const locale = toLocale(runtimeConfig.config.locale.language)

  return (
    <html
      lang={locale}
      className={`
        theme-${runtimeSite.themeColor}
      `}
      suppressHydrationWarning
    >
      <head>
        <script id="theme-initializer">{themeInitializer}</script>
      </head>
      <body>
        <Providers detectedLocale={locale}>{children}</Providers>
      </body>
    </html>
  )
}
