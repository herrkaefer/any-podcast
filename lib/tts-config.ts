import type { RuntimeTtsConfig } from '@/types/runtime-config'

export function getEdgeVoiceDefaults(language: string) {
  if (language.toLowerCase().startsWith('en')) {
    return { male: 'en-US-GuyNeural', female: 'en-US-JennyNeural' }
  }
  if (language.toLowerCase().startsWith('zh')) {
    return { male: 'zh-CN-YunxiNeural', female: 'zh-CN-XiaoxiaoNeural' }
  }
  throw new Error(`Configure an explicit Edge TTS voice for unsupported language: ${language}`)
}

export function isCompatibleEdgeVoice(voice: string, language: string) {
  return voice.toLowerCase().startsWith(`${language.split('-')[0].toLowerCase()}-`)
    && voice.endsWith('Neural')
    && !voice.includes('Multilingual')
}

export function edgeRate(speed: string | number | undefined): string {
  const value = speed === undefined ? 0 : Number(String(speed).replace('%', ''))
  if (!Number.isFinite(value) || value < -50 || value > 100) {
    throw new Error('Edge TTS speed must be a percentage between -50 and 100 (0 is normal speed)')
  }
  return `${value >= 0 ? '+' : ''}${value}%`
}

export function edgeTtsPatch(language: string, hosts: Array<{ id: string, gender?: string }>): Pick<RuntimeTtsConfig, 'provider' | 'language' | 'voices' | 'speed' | 'model' | 'apiUrl'> {
  const defaults = getEdgeVoiceDefaults(language)
  return {
    provider: 'edge',
    language,
    voices: Object.fromEntries(hosts.map((host, index) => [
      host.id,
      (host.gender || (index === 0 ? 'male' : 'female')) === 'male' ? defaults.male : defaults.female,
    ])),
    speed: '+0%',
    model: '',
    apiUrl: '',
  }
}
