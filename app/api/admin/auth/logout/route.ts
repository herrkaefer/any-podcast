import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { deleteAdminSession, getSessionCookieOptions, getSessionIdFromRequest } from '@/lib/admin-auth'

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const sid = getSessionIdFromRequest(request)

  if (sid) {
    await deleteAdminSession(adminEnv, sid)
  }

  const response = NextResponse.json({ ok: true })
  const secure = new URL(request.url).protocol === 'https:'
  const cookie = getSessionCookieOptions({ secure })
  response.cookies.set(cookie.name, '', {
    ...cookie,
    maxAge: 0,
  })
  return response
}
