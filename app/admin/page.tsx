import { getCloudflareContext } from '@opennextjs/cloudflare'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AdminConfigConsole } from '@/components/admin/config-console'
import { EpisodeManagement } from '@/components/admin/episode-management'
import { AdminWorkbench } from '@/components/admin/workbench'
import { ADMIN_SESSION_COOKIE, readAdminSession } from '@/lib/admin-auth'
import { getDraftRuntimeConfig } from '@/lib/runtime-config'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const cookieStore = await cookies()
  const sid = cookieStore.get(ADMIN_SESSION_COOKIE)?.value || ''
  const session = await readAdminSession(adminEnv, sid)

  if (!session) {
    redirect('/admin/login')
  }

  const draft = await getDraftRuntimeConfig(adminEnv)

  return (
    <main className="container mx-auto space-y-6 px-4 py-8">
      <section className="rounded-lg border p-4">
        <h1 className="text-2xl font-semibold">Admin Console</h1>
        <p className="mt-2 text-sm text-gray-600">
          Current user:
          {' '}
          {session.user}
        </p>
        <p className="text-sm text-gray-600">Config changes are saved and applied immediately. No revision history is kept.</p>
      </section>

      <AdminConfigConsole />

      <AdminWorkbench initialDraft={draft} />
      <EpisodeManagement />
    </main>
  )
}
