import { NextResponse } from 'next/server'
import { loadSettings } from '@/lib/config'
import { qdrant } from '@/lib/qdrant'
import { render } from '@/lib/prometheus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Prometheus 指标暴露 GET /api/v1/metrics */
export async function GET() {
  const text = render()
  return new NextResponse(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
