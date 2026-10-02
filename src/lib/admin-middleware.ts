import { NextRequest, NextResponse } from 'next/server'
import { parseAdminSession, AdminAuth } from './auth'
import { GatewayError, toGatewayError } from './errors'
import { getClientIp, getRequestId, jsonResponse, errorResponse } from './http'

/**
 * 管理后台鉴权中间件 —— 包装 route handler，注入 adminAuth
 * 用法：export const POST = withAdmin((req, admin) => { ... })
 */

type Handler = (
  req: NextRequest,
  ctx: { admin: AdminAuth; requestId: string; clientIp: string; userAgent: string },
  params?: Record<string, string>,
) => Promise<NextResponse> | NextResponse

export function withAdmin(handler: Handler, opts?: { role?: 'admin' | 'viewer' }): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    const requestId = getRequestId(req)
    const clientIp = getClientIp(req)
    const userAgent = req.headers.get('user-agent') ?? ''
    try {
      const admin = await parseAdminSession(req.headers.get('cookie'))
      if (!admin) {
        throw new GatewayError('UNAUTHORIZED', '管理后台未登录或会话已过期')
      }
      if (opts?.role === 'admin' && admin.role !== 'admin') {
        throw new GatewayError('FORBIDDEN', '需要管理员权限（当前为只读观察者）')
      }
      return await handler(req, { admin, requestId, clientIp, userAgent })
    } catch (e) {
      return errorResponse(toGatewayError(e), requestId)
    }
  }
}

/** 从动态路由参数提取 [id] 等 */
export function routeParams(req: NextRequest): Record<string, string> {
  // Next.js App Router 动态参数通过 context.params 传入，这里从 URL 兜底解析
  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const params: Record<string, string> = {}
  // 末尾段视为 id（简化处理，实际用 context 更可靠）
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i]
    // UUID-like or cuid-like
    if (seg.length > 8 && /^[a-z0-9_-]+$/i.test(seg)) {
      params.id = seg
      break
    }
  }
  return params
}
