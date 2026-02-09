import type { AdminSession } from '@/types/runtime-config'

import { adminSessionSchema } from './schemas/admin'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
export const ADMIN_SESSION_COOKIE = 'admin_session'

function buildSessionKey(sid: string) {
  return `admin:session:${sid}`
}

function parseCookie(header: string | null, key: string) {
  if (!header) {
    return ''
  }
  const pairs = header.split(';')
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.trim().split('=')
    if (rawKey === key) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return ''
}

export function getSessionIdFromRequest(request: Request) {
  return parseCookie(request.headers.get('cookie'), ADMIN_SESSION_COOKIE)
}

export async function createAdminSession(env: AdminEnv, user = 'admin') {
  const sid = crypto.randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString()
  const session: AdminSession = {
    sid,
    user,
    createdAt: now.toISOString(),
    expiresAt,
  }
  await env.PODCAST_KV.put(buildSessionKey(sid), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
  return session
}

export async function readAdminSession(env: AdminEnv, sid: string) {
  if (!sid) {
    return null
  }
  const json = await env.PODCAST_KV.get(buildSessionKey(sid), 'json')
  if (!json) {
    return null
  }
  const parsed = adminSessionSchema.safeParse(json)
  if (!parsed.success) {
    return null
  }
  const session = parsed.data
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await env.PODCAST_KV.delete(buildSessionKey(sid))
    return null
  }
  return session
}

export async function deleteAdminSession(env: AdminEnv, sid: string) {
  if (!sid) {
    return
  }
  await env.PODCAST_KV.delete(buildSessionKey(sid))
}

export function getSessionCookieOptions(options?: { secure?: boolean }) {
  return {
    name: ADMIN_SESSION_COOKIE,
    httpOnly: true,
    secure: options?.secure ?? true,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}

export async function requireAdminSession(request: Request, env: AdminEnv) {
  const sid = getSessionIdFromRequest(request)
  if (!sid) {
    return null
  }
  return readAdminSession(env, sid)
}
