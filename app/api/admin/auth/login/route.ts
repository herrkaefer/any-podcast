import process from 'node:process'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { jsonError, parseJsonWithSchema } from '@/lib/admin-api'
import { createAdminSession, getSessionCookieOptions } from '@/lib/admin-auth'
import { adminLoginSchema } from '@/lib/schemas/admin'

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const configuredToken = adminEnv.ADMIN_TOKEN || process.env.ADMIN_TOKEN

  if (!configuredToken) {
    return jsonError('ADMIN_TOKEN is not configured', 500)
  }

  try {
    const payload = await parseJsonWithSchema(request, adminLoginSchema)
    if (payload.token !== configuredToken) {
      return jsonError('Invalid admin token', 401)
    }

    const session = await createAdminSession(adminEnv)
    const response = NextResponse.json({
      ok: true,
      user: session.user,
      expiresAt: session.expiresAt,
    })
    const secure = new URL(request.url).protocol === 'https:'
    const cookie = getSessionCookieOptions({ secure })
    response.cookies.set(cookie.name, session.sid, cookie)
    return response
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return jsonError(message, 400)
  }
}
