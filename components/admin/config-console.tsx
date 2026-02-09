'use client'

import { useState } from 'react'

interface ActionResult {
  ok: boolean
  message: string
}

async function postJson(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Request failed: ${response.status}`
    throw new Error(message)
  }
  return body
}

export function AdminConfigConsole() {
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, setPending] = useState<string>('')

  async function runAction(
    actionName: string,
    action: () => Promise<Record<string, unknown> | null>,
    successMessage: string,
  ) {
    setPending(actionName)
    setResult(null)
    try {
      await action()
      setResult({ ok: true, message: successMessage })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed'
      setResult({ ok: false, message })
    }
    finally {
      setPending('')
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Config Actions</h2>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending !== ''}
          onClick={() => runAction('validate', () => postJson('/api/admin/config/validate', {}), 'Draft validation completed')}
          className={`
            rounded border px-2 py-1 text-xs
            disabled:opacity-50
          `}
        >
          Validate Draft
        </button>
        <button
          type="button"
          disabled={pending !== ''}
          onClick={() => runAction('logout', () => postJson('/api/admin/auth/logout', {}), 'Logged out')}
          className={`
            rounded border px-2 py-1 text-xs
            disabled:opacity-50
          `}
        >
          Logout
        </button>
      </div>

      {result
        ? (
            <p className={result.ok
              ? 'text-sm text-green-700'
              : `text-sm text-red-700`}
            >
              {result.message}
            </p>
          )
        : null}
    </div>
  )
}
