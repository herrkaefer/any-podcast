// SPDX-License-Identifier: LGPL-3.0-only
// Adapted from rany2/edge-tts, src/edge_tts/drm.py (Sec-MS-GEC v2).
// Source: https://github.com/rany2/edge-tts/blob/bd44c1d1aaebdc1db7f47456ee12431b42ec7cac/src/edge_tts/drm.py
// Copyright (c) 2025- rany. See LICENSE in this directory.
// TypeScript adaptation: Any Podcast contributors, 2026.
// Constants describe the SHA-256 prefix state and CS64 checksum used by Edge.

const _SHA256_INITIAL = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]

const _SHA256_STATE = [4255104674, 2435071207, 3192492180, 3442351626, 1811967817, 79508907, 4272990180, 66059218]

const _SHA256_SCHEDULE = [3945054110, 358115615, 2696978146, 217723578, 2787307148, 3520959633, 3235718560, 4192668342, 4039316851, 1884868174, 1904797190, 15051571, 3529027680, 1920361828]

const _SHA256_ROUND_CONSTANTS = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]

const _CS64_COEFFICIENTS = [[3895366065, 3005677776], [1155409094, 2296378653], [1005282748, 693190712], [3365689651, 3005795295], [2367603217, 3557143765], [827258325, 652566332], [3911487921, 1618477510], [4037392853, 2192753147], [101076211, 4199654362], [3665427040, 545047652], [3201434976, 1010595059], [2314848760, 3536931681], [905590982, 3137643201], [3410617286, 3311559015]]

const rotateRight = (x: number, n: number) => (x >>> n) | (x << (32 - n))
const swapHalves = (x: number) => ((x << 16) | (x >>> 16)) >>> 0
const sigma0 = (x: number) => rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3)
const sigma1 = (x: number) => rotateRight(x, 17) ^ rotateRight(x, 19) ^ (x >>> 10)

function expand(words: number[], start = 16) {
  for (let i = start; i < 64; i++)
    words[i] = (sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) >>> 0
}

function rounds(initial: number[], words: number[], start = 0) {
  let [a, b, c, d, e, f, g, h] = initial
  for (let i = start; i < 64; i++) {
    const constant = start === 14 && i === 14 ? 0xC9DC06A7 : _SHA256_ROUND_CONSTANTS[i]
    const t1 = (h + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25))
      + (g ^ (e & (f ^ g))) + constant + words[i]) >>> 0
    const t2 = ((rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0
    ;[a, b, c, d, e, f, g, h] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g]
  }
  return [a, b, c, d, e, f, g, h]
}

function digest(data: Uint8Array) {
  if (data.length < 7)
    throw new Error('Edge token payload must contain at least seven bytes')
  const words = Array.from({ length: 14 }, () => 0)
  words.push((data[0] << 16) | (data[1] << 8) | data[2])
  words.push(((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0)
  for (let i = 16; i < 30; i++) {
    let value = _SHA256_SCHEDULE[i - 16] + (i === 16 ? (sigma1(words[i - 2]) ^ 0x000B92C0) >>> 0 : sigma1(words[i - 2]) >>> 0)
    if (i >= 21)
      value += words[i - 7]
    if (i === 29)
      value += (sigma0(words[i - 15]) ^ 0x059C0B80) >>> 0
    words.push(value >>> 0)
  }
  words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + 0xC9DC06A7 - _SHA256_ROUND_CONSTANTS[14]) >>> 0)
  expand(words, 31)
  let state = rounds(_SHA256_STATE, words, 14).map((v, i) => (v + _SHA256_INITIAL[i]) >>> 0)
  const length = 57 + data.length
  const padding = ((55 - length) % 64 + 64) % 64
  const tail = new Uint8Array(data.length - 7 + 1 + padding + 8)
  tail.set(data.subarray(7))
  tail[data.length - 7] = 0x80
  const view = new DataView(tail.buffer)
  view.setUint32(tail.length - 8, Math.floor(length * 8 / 2 ** 32))
  view.setUint32(tail.length - 4, length * 8 >>> 0)
  for (let offset = 0; offset < tail.length; offset += 64) {
    const block = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4))
    expand(block)
    state = rounds(state, block).map((v, i) => (v + state[i]) >>> 0)
  }
  const bytes = new Uint8Array(32)
  const output = new DataView(bytes.buffer)
  state.forEach((v, i) => output.setUint32(i * 4, v))
  return bytes
}

function checksum(data: Uint8Array, hash: Uint8Array) {
  const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength)
  const keyA = (view.getUint32(0, true) | 1) >>> 0
  const keyB = (view.getUint32(4, true) | 1) >>> 0
  const factors = [Math.imul(keyA, 0x82893933), Math.imul(keyB, 0x82893933)]
  const terms = _CS64_COEFFICIENTS.map(([coefficient], i) => Math.imul(coefficient, factors[i % 2]) >>> 0)
  const offsets = _CS64_COEFFICIENTS.map(([, offset]) => offset)
  const padded = new Uint8Array(Math.ceil((data.length + 1) / 8) * 8)
  padded.set(data, 1)
  const input = new DataView(padded.buffer)
  for (let i = 0; i < padded.length / 4; i++) {
    const word = input.getUint32(i * 4, true)
    let term = Math.imul(word, i % 2 === 0 ? keyA : keyB)
    let offset = Math.imul(swapHalves(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB)
    if (i === 0) {
      term += Math.imul(0xF2F90B1A, factors[0])
      offset += 0x0B1A0000
    }
    terms.push(term >>> 0)
    offsets.push(offset >>> 0)
  }
  let swapAcc = 0
  let swapLast = 0
  let state = 0
  let acc = 0
  for (let i = 0; i < terms.length; i += 2) {
    let q = Math.imul(swapHalves((offsets[i] + terms[i]) >>> 0), 0x76F50F34) >>> 0
    swapAcc = (swapAcc + Math.imul(swapHalves(q), 0xC3EFEA97) + q) >>> 0
    q = Math.imul(swapHalves((offsets[i + 1] + terms[i + 1]) >>> 0), 0x1881CE3C) >>> 0
    swapLast = (Math.imul(swapHalves(q), 0x35BD1EC9) + q) >>> 0
    swapAcc = (swapAcc + swapLast) >>> 0
    state = (Math.imul(state, keyA) + terms[i]) >>> 0
    for (const factor of [0xCF98B111, 0x87085B9F, 0x12CEB96D, 0x257E1D83])
      state = Math.imul(swapHalves(state), factor) >>> 0
    acc = (acc + state) >>> 0
    state = (Math.imul(state, keyB) + terms[i + 1]) >>> 0
    for (const factor of [0xA27416F5, 0xD38396FF, 0x7C932B89, 0xBFA49F69])
      state = Math.imul(swapHalves(state), factor) >>> 0
    acc = (acc + state) >>> 0
  }
  const result = new Uint8Array(8)
  const output = new DataView(result.buffer)
  output.setUint32(0, (swapLast ^ state) >>> 0, true)
  output.setUint32(4, (swapAcc ^ acc) >>> 0, true)
  return result
}

export function edgeTokenV2(clientToken: string, unixSeconds = Date.now() / 1000) {
  const seconds = unixSeconds + 11644473600
  const ticks = ((seconds - seconds % 300) * 1e7).toFixed(0)
  const data = new TextEncoder().encode(ticks + clientToken)
  const hash = digest(data)
  const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${hex(checksum(data, hash))}-${hex(hash)}`
}
