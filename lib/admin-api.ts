import type { ZodType } from 'zod'

import { NextResponse } from 'next/server'

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function parseJsonWithSchema<T>(request: Request, schema: ZodType<T>) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Content-Type must be application/json')
  }
  const text = await request.text()
  if (!text.trim()) {
    throw new Error('Request body is empty')
  }
  const raw = JSON.parse(text) as unknown
  return schema.parse(raw)
}
