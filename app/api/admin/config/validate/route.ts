import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/admin-api'
import { requireAdminSession } from '@/lib/admin-auth'
import { getDraftRuntimeConfig } from '@/lib/runtime-config'
import { findUnknownTemplateVariables, getTemplateVariables } from '@/lib/template'

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  try {
    const config = await getDraftRuntimeConfig(adminEnv)
    const warnings: string[] = []

    const markers = config.hosts.map(host => host.speakerMarker.trim()).filter(Boolean)
    const markerSet = new Set(markers)
    if (markers.length !== markerSet.size) {
      warnings.push('hosts.speakerMarker 不能重复，否则对话分段会冲突')
    }

    for (const host of config.hosts) {
      if (!config.tts.voices[host.id]) {
        warnings.push(`tts.voices 缺少 host "${host.id}" 的 voice 映射`)
      }
    }

    const variables = getTemplateVariables(config)
    const promptMap = {
      summarizeStory: config.prompts.summarizeStory,
      summarizePodcast: config.prompts.summarizePodcast,
      summarizeBlog: config.prompts.summarizeBlog,
      intro: config.prompts.intro,
      title: config.prompts.title,
      extractNewsletterLinks: config.prompts.extractNewsletterLinks,
    }

    for (const [name, value] of Object.entries(promptMap)) {
      const unknown = findUnknownTemplateVariables(value, variables)
      if (unknown.length > 0) {
        warnings.push(`prompts.${name} 包含未知模板变量: ${unknown.join(', ')}`)
      }
    }

    return NextResponse.json({
      valid: true,
      warnings,
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Validation failed'
    return jsonError(message, 400)
  }
}
