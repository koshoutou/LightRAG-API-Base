import { NextRequest } from 'next/server'
import { parseAdminSession } from '@/lib/auth'
import { toGatewayError } from '@/lib/errors'
import { getRequestId, jsonResponse, errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req)
  try {
    const admin = await parseAdminSession(req.headers.get('cookie'))
    if (!admin) {
      return jsonResponse({ authenticated: false }, { status: 200, requestId })
    }
    return jsonResponse({
      authenticated: true,
      user: { id: admin.userId, username: admin.username, role: admin.role },
    })
  } catch (e) {
    return errorResponse(toGatewayError(e), requestId)
  }
}
