import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { jsonError, parseJsonWithSchema } from '@/lib/admin-api'
import { requireAdminSession } from '@/lib/admin-auth'
import {
  getDraftRuntimeConfig,
  mergeRuntimeConfig,
  saveDraftRuntimeConfig,
} from '@/lib/runtime-config'
import { runtimeConfigPatchSchema } from '@/lib/schemas/admin'

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  const draft = await getDraftRuntimeConfig(adminEnv)

  return NextResponse.json({
    draft,
  })
}

export async function PUT(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  try {
    const patch = await parseJsonWithSchema(request, runtimeConfigPatchSchema)
    const current = await getDraftRuntimeConfig(adminEnv)
    const merged = mergeRuntimeConfig(current, patch)
    const note = patch.meta?.note ?? current.meta.note
    const saved = await saveDraftRuntimeConfig(adminEnv, merged, {
      updatedBy: session.user,
      note,
    })
    return NextResponse.json({ ok: true, draft: saved })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update draft config'
    return jsonError(message, 400)
  }
}
