import synthesize, { validateTtsConfig } from '../workflow/tts'

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return new Response('POST a TTS sample', { status: 405 })
    }
    try {
      const { text, speaker, options } = await request.json() as {
        text: string
        speaker: string
        options: Parameters<typeof synthesize>[3]
      }
      validateTtsConfig({ NODE_ENV: 'production' } as unknown as CloudflareEnv, options?.provider)
      const audio = await synthesize(text, speaker, {} as CloudflareEnv, options)
      return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } })
    }
    catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 500 })
    }
  },
}
