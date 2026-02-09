'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function AdminLoginForm() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token.trim()) {
      setError('Please enter admin token')
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || 'Login failed')
      }

      router.push('/admin')
      router.refresh()
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      setError(message)
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`
        mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border p-6
      `}
    >
      <h1 className="text-xl font-semibold">Admin Login</h1>
      <label className="flex flex-col gap-2 text-sm">
        <span>Admin token</span>
        <input
          type="password"
          value={token}
          onChange={event => setToken(event.target.value)}
          placeholder="Enter ADMIN_TOKEN"
          className="rounded border px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className={`
          rounded bg-black px-4 py-2 text-white
          disabled:cursor-not-allowed disabled:opacity-50
        `}
      >
        {loading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  )
}
