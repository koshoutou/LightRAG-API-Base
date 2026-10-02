import { NextRequest } from 'next/server'
import { parseAdminSession, revokeAdminSession, ADMIN_SESSION_COOKIE } from '@/lib/auth'
import { toGatewayError } from '@/lib/errors'
import { getClientIp, getRequestId, jsonResponse, errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const clientIp = getClientIp(req)
  try {
    const admin = await parseAdminSession(req.headers.get('cookie'))
    if (admin) {
      const cookie = req.headers.get('cookie') ?? ''
      const token = new RegExp(`(?:^|;)\\s*${ADMIN_SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1]
      if (token) await revokeAdminSession(decodeURIComponent(token.trim()))
    }
    const res = jsonResponse({ ok: true })
    res.cookies.delete(ADMIN_SESSION_COOKIE)
    return res
  } catch (e) {
    return errorResponse(toGatewayError(e), requestId)
  }
}
