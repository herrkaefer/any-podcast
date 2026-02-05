/* eslint-disable node/prefer-global/process */
import type { Podcast, Site } from '@/types/podcast'

const defaultTitle = 'Any Podcast'
const defaultDescription
  = '一个可配置的 AI 播客平台：自动聚合内容源，生成中文摘要并输出播客音频。'
const defaultBaseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

export const keepDays = 30

export const podcast: Podcast = {
  base: {
    title: defaultTitle,
    description: defaultDescription,
    link: defaultBaseUrl,
    cover: '/logo.png',
  },
  hosts: [
    {
      name: 'Gemini',
      link: 'https://gemini.google',
    },
    {
      name: 'MiniMax',
      link: 'https://www.minimaxi.com/audio',
    },
  ],
  platforms: [
    {
      id: 'rss',
      name: 'RSS',
      link: `${defaultBaseUrl}/rss.xml`,
    },
  ],
}

export const site: Site = {
  themeColor: 'orange',
  pageSize: 7,
  defaultDescriptionLength: 200,
  seo: {
    siteName: defaultTitle,
    defaultTitle,
    defaultDescription,
    defaultImage: '/opengraph-image.png',
    twitterHandle: '',
    locale: 'zh_CN',
  },
  favicon: '/favicon.png',
}

export const externalLinks = {
  github: 'https://github.com/herrkaefer/any-podcast',
  rss: '/rss.xml',
}

export const podcastTitle = podcast.base.title
export const podcastDescription = podcast.base.description
