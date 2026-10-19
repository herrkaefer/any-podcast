interface QueueOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  lastStartedAt?: number
  onStart?: (time: number) => Promise<void>
}

export const RENDER_INTERVAL_MS = 11000

/** Serializes starts and keeps a minimum interval, including after failures. */
export class RenderRequestQueue {
  private tail: Promise<void> = Promise.resolve()
  private lastStartedAt: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly intervalMs = RENDER_INTERVAL_MS, private readonly options: QueueOptions = {}) {
    this.lastStartedAt = options.lastStartedAt ?? 0
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const delay = this.lastStartedAt + this.intervalMs - this.now()
      if (delay > 0)
        await this.sleep(delay)
      this.lastStartedAt = this.now()
      await this.options.onStart?.(this.lastStartedAt)
      return task()
    })
    this.tail = result.then(() => {}, () => {})
    return result
  }
}
