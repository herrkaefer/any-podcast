interface AdminEnv extends CloudflareEnv {
  PODCAST_KV: KVNamespace
  PODCAST_R2: R2Bucket
  NODE_ENV: string
  ADMIN_TOKEN?: string
  TTS_PROVIDER?: string
  TTS_MODEL?: string
  MAN_VOICE_ID?: string
  WOMAN_VOICE_ID?: string
}
