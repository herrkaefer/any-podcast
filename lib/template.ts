import type { RuntimeConfigBundle, RuntimePromptsConfig } from '@/types/runtime-config'

const templateRegex = /\{\{\s*(\w+)\s*\}\}/g

export function getTemplateVariables(config: RuntimeConfigBundle): Record<string, string> {
  const host1 = config.hosts[0]
  const host2 = config.hosts[1]

  return {
    podcastTitle: config.site.title,
    podcastDescription: config.site.description,
    host1Name: host1?.name || '',
    host1Persona: host1?.persona || '',
    host1Marker: host1?.speakerMarker || '',
    host2Name: host2?.name || '',
    host2Persona: host2?.persona || '',
    host2Marker: host2?.speakerMarker || '',
    language: config.locale.language,
    timezone: config.locale.timezone,
  }
}

export function renderTemplate(input: string, variables: Record<string, string>): string {
  return input.replace(templateRegex, (_, name: string) => variables[name] ?? '')
}

export function renderPromptTemplates(prompts: RuntimePromptsConfig, variables: Record<string, string>): RuntimePromptsConfig {
  return {
    summarizeStory: renderTemplate(prompts.summarizeStory, variables),
    summarizePodcast: renderTemplate(prompts.summarizePodcast, variables),
    summarizeBlog: renderTemplate(prompts.summarizeBlog, variables),
    intro: renderTemplate(prompts.intro, variables),
    title: renderTemplate(prompts.title, variables),
    extractNewsletterLinks: renderTemplate(prompts.extractNewsletterLinks, variables),
  }
}

export function collectTemplateVariables(input: string): string[] {
  const found = new Set<string>()
  for (const match of input.matchAll(templateRegex)) {
    const key = match[1]?.trim()
    if (key) {
      found.add(key)
    }
  }
  return Array.from(found)
}

export function findUnknownTemplateVariables(input: string, variables: Record<string, string>): string[] {
  const all = collectTemplateVariables(input)
  return all.filter(key => !(key in variables))
}
