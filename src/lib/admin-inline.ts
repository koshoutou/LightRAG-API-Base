import { NextRequest, NextResponse } from 'next/server'
import { parseAdminSession, AdminAuth } from './auth'
import { toGatewayError } from './errors'
import { getClientIp, getRequestId, errorResponse } from './http'

/**
 * 内联管理后台鉴权 —— 用于动态路由（需要保留 ctx.params）
 * 用法：
 *   export async function GET(req: NextRequest, ctx: { params: Promise<{id:string}> }) {
 *     return withAdminInline(req, async (admin, httpCtx) => { ... })
 *   }
 */

interface HttpCtx {
  admin: AdminAuth
  requestId: string
  clientIp: string
  userAgent: string
}

export async function withAdminInline(
  req: NextRequest,
  handler: (admin: AdminAuth, httpCtx: HttpCtx) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = getRequestId(req)
  const clientIp = getClientIp(req)
  const userAgent = req.headers.get('user-agent') ?? ''
  try {
    const admin = await parseAdminSession(req.headers.get('cookie'))
    if (!admin) {
      return errorResponse(toGatewayError(new Error('管理后台未登录或会话已过期')), requestId)
    }
    return await handler(admin, { admin, requestId, clientIp, userAgent })
  } catch (e) {
    return errorResponse(toGatewayError(e), requestId)
  }
}
