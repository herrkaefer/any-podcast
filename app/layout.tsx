import type { Metadata } from 'next'
import type { Locale } from '@/i18n/config'
import process from 'node:process'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { headers } from 'next/headers'
import { Providers } from '@/components/providers'
import { podcast, site } from '@/config'
import { defaultLocale, detectLocale } from '@/i18n/config'
import { getActiveRuntimeConfig } from '@/lib/runtime-config'
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

function resolveMetadataBase() {
  const candidates = [process.env.NEXT_PUBLIC_BASE_URL, podcast.base.link, 'http://localhost:3000']
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    try {
      return new URL(candidate)
    }
    catch {
      continue
    }
  }
  return new URL('http://localhost:3000')
}

const metadataBase = resolveMetadataBase()

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: site.seo.defaultTitle,
    template: `%s · ${site.seo.siteName}`,
  },
  description: site.seo.defaultDescription,
  alternates: {
    types: {
      'application/rss+xml': [
        {
          url: '/rss.xml',
          title: site.seo.defaultTitle,
        },
      ],
    },
  },
  openGraph: {
    title: site.seo.defaultTitle,
    description: site.seo.defaultDescription,
    url: podcast.base.link,
    type: 'website',
    images: [
      {
        url: site.seo.defaultImage,
        alt: site.seo.defaultTitle,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: site.seo.twitterHandle,
    title: site.seo.defaultTitle,
    description: site.seo.defaultDescription,
    images: [site.seo.defaultImage],
  },
  icons: {
    icon: site.favicon,
  },
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
  const headersList = await headers()
  const acceptLanguage = headersList.get('accept-language')
  const detectedLocale: Locale = acceptLanguage ? detectLocale(acceptLanguage) : defaultLocale

  return (
    <html
      lang={detectedLocale}
      className={`
        theme-${runtimeSite.themeColor}
      `}
      suppressHydrationWarning
    >
      <head>
        <script id="theme-initializer">{themeInitializer}</script>
      </head>
      <body>
        <Providers detectedLocale={detectedLocale}>{children}</Providers>
      </body>
    </html>
  )
}
