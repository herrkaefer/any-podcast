import type { RuntimeConfigBundle } from '@/types/runtime-config'

export interface ParsedConversationLine {
  speaker: string
  text: string
  raw: string
}

export interface RuntimeTtsSettings {
  provider: 'edge' | 'minimax' | 'murf' | 'gemini'
  language: string
  languageBoost?: 'auto' | 'Chinese' | 'English'
  model?: string
  speed?: string | number
  apiUrl?: string
  geminiPrompt?: string
  voicesBySpeaker: Record<string, string>
  geminiSpeakers: { speaker: string, voice?: string }[]
}

export function getSpeakerMarkers(config: RuntimeConfigBundle) {
  const markers = config.hosts
    .map(host => host.speakerMarker.trim())
    .filter(Boolean)
  if (markers.length === 0) {
    throw new Error('No speaker markers configured in hosts. Please configure hosts with speakerMarker in admin.')
  }
  return markers
}

function normalizeDialogText(value: string) {
  return value.replace(/^[:：]\s*/, '').trim()
}

export function parseConversationLines(lines: string[], markers: string[]): ParsedConversationLine[] {
  const normalizedMarkers = markers
    .map(marker => marker.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  return lines
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return null
      }

      const matched = normalizedMarkers.find(marker => trimmed.startsWith(marker))
      if (!matched) {
        return null
      }

      const content = normalizeDialogText(trimmed.slice(matched.length))
      if (!content) {
        return null
      }

      return {
        speaker: matched,
        text: content,
        raw: trimmed,
      } satisfies ParsedConversationLine
    })
    .filter((item): item is ParsedConversationLine => Boolean(item))
}

export function buildRuntimeTtsSettings(config: RuntimeConfigBundle): RuntimeTtsSettings {
  const provider = config.tts.provider || 'edge'
  const voicesBySpeaker: Record<string, string> = {}

  for (const host of config.hosts) {
    const voice = config.tts.voices[host.id]
    if (voice) {
      voicesBySpeaker[host.speakerMarker] = voice
    }
  }

  const geminiSpeakers = config.hosts
    .map(host => ({
      speaker: host.speakerMarker,
      voice: config.tts.voices[host.id],
    }))
    .filter(item => item.speaker)

  return {
    provider,
    language: config.tts.language || 'zh-CN',
    languageBoost: config.tts.languageBoost,
    model: config.tts.model || undefined,
    speed: config.tts.speed,
    apiUrl: config.tts.apiUrl,
    geminiPrompt: config.tts.geminiPrompt || undefined,
    voicesBySpeaker,
    geminiSpeakers,
  }
}
