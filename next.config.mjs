import process from 'node:process'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const isProd = process.env.NODE_ENV === 'production'

if (!isProd) {
  initOpenNextCloudflareForDev()
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  expireTime: 86400,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: isProd
    ? {
        loader: 'custom',
        loaderFile: './lib/weserv-image-loader.ts',
      }
    : undefined,
  rewrites: () => [
    {
      source: '/blog.xml',
      destination: '/rss.xml',
    },
  ],
}

export default nextConfig
