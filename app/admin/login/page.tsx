import { AdminLoginForm } from '@/components/admin/login-form'

export const dynamic = 'force-dynamic'

export default function AdminLoginPage() {
  return (
    <main className="container mx-auto px-4 py-10">
      <AdminLoginForm />
    </main>
  )
}
