interface AdminEnv extends CloudflareEnv {
  PODCAST_KV: KVNamespace
  PODCAST_R2: R2Bucket
  NODE_ENV: string
  PODCAST_ID?: string
  ADMIN_TOKEN?: string
  PODCAST_WORKER_URL?: string
  TRIGGER_TOKEN?: string
}
