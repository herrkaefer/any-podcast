import type { SocketLike } from '@andresaya/edge-tts/dist/core/session'
import type { SynthesisOptions } from '@andresaya/edge-tts/dist/core/types'
import { Constants } from '@andresaya/edge-tts/dist/config/constants'
import { EdgeTTSCore } from '@andresaya/edge-tts/dist/core/base'
import { buildSSML } from '@andresaya/edge-tts/dist/core/protocol'
import { edgeTokenV2 } from './edge-drm'

// The read-aloud endpoint requires the v2 signature since October 2026.
// The package's v1 alternate endpoint rate-limits Workers egress heavily.
const edgeVersion = '143.0.3650.75'
const edgeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'
const edgeOptions = {
  timeout: 30000,
  wssUrl: `${Constants.BASE_URL.replace('https:', 'wss:')}/edge/v1`,
  secMsGecVersion: `2-${edgeVersion}`,
  headers: { 'User-Agent': edgeUserAgent },
}

function readAloudUrl(url: string) {
  return url.replace('Ocp-Apim-Subscription-Key=', 'TrustedClientToken=')
}

// Workers initiate outbound WebSockets through fetch() and accept(). The native
// browser WebSocket constructor cannot supply the service's required headers.
class WorkerEdgeTTS extends EdgeTTSCore {
  protected readonly defaultVoice = 'en-US-GuyNeural'

  protected async signature() { return edgeTokenV2(Constants.TRUSTED_CLIENT_TOKEN) }

  protected openSocket(url: string): SocketLike {
    let upstream: WebSocket | undefined
    let closed = false
    const controller = new AbortController()
    const socket: SocketLike = {
      binaryType: 'arraybuffer',
      get readyState() { return closed ? 3 : upstream?.readyState ?? 0 },
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data) { upstream?.send(data) },
      close() {
        closed = true
        if (upstream)
          upstream.close(1000, 'Finished')
        else
          controller.abort()
      },
    }
    void fetch(readAloudUrl(url).replace(/^wss:/, 'https:'), {
      headers: {
        ...Constants.getBaseHeaders(),
        ...Constants.WSS_HEADERS,
        'User-Agent': edgeUserAgent,
        'Upgrade': 'websocket',
      },
      signal: controller.signal,
    }).then((response) => {
      if (closed) {
        response.webSocket?.close(1000, 'Cancelled')
        return
      }
      upstream = response.webSocket ?? undefined
      if (!upstream) {
        const retryAfter = response.headers.get('retry-after')
        throw new Error(`Edge TTS WebSocket upgrade failed: HTTP ${response.status}${retryAfter ? `; Retry-After: ${retryAfter}` : ''}`)
      }
      upstream.addEventListener('message', event => socket.onmessage?.({ data: event.data }))
      upstream.addEventListener('error', event => socket.onerror?.(event))
      upstream.addEventListener('close', event => socket.onclose?.(event))
      upstream.accept()
      socket.onopen?.({})
    }).catch(error => socket.onerror?.(error))
    return socket
  }

  protected async requestVoices(url: string) {
    const response = await fetch(url, { headers: Constants.getBaseHeaders() })
    if (!response.ok) {
      throw new Error(`Edge voice list failed: HTTP ${response.status}`)
    }
    return response.json() as Promise<unknown[]>
  }

  protected buildSSML(text: string, voice: string, options: SynthesisOptions) {
    return buildSSML(text, voice, '+0Hz', String(options.rate ?? '+0%'), '+0%')
  }

  protected timestamp() { return new Date().toUTCString() }
  protected socketError(error: unknown) {
    return error instanceof Error ? error : new Error('Edge TTS WebSocket failed')
  }
}

export async function synthesizeEdgeAudio(text: string, voice: string, rate: string): Promise<Blob> {
  if (!text.trim()) {
    throw new Error('Edge TTS input is empty')
  }
  let client: EdgeTTSCore
  if (typeof WebSocketPair !== 'undefined') {
    client = new WorkerEdgeTTS(edgeOptions)
  }
  else {
    const { EdgeTTS } = await import('@andresaya/edge-tts')
    class NodeEdgeTTS extends EdgeTTS {
      protected async signature() { return edgeTokenV2(Constants.TRUSTED_CLIENT_TOKEN) }
      protected openSocket(url: string) { return super.openSocket(readAloudUrl(url)) }
    }
    client = new NodeEdgeTTS(edgeOptions)
  }
  const result = await client.generate(text, voice, {
    rate,
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    signal: AbortSignal.timeout(90000),
  })
  if (!result.audio.byteLength) {
    throw new Error('Edge TTS returned empty audio')
  }
  return new Blob([new Uint8Array(result.audio)], { type: 'audio/mpeg' })
}
