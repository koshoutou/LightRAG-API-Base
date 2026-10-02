import { NextRequest, NextResponse } from 'next/server'
import { GatewayError, toGatewayError } from './errors'

/**
 * HTTP 上下文与响应工具
 */

/** 提取客户端 IP（兼容 Caddy X-Forwarded-For） */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return ''
}

/** 提取或生成 requestId（Caddy/网关透传或自生成） */
export function getRequestId(req: NextRequest): string {
  const existing = req.headers.get('x-request-id')
  if (existing) return existing
  return `lra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 统一 JSON 响应（带 CORS + requestId） */
export function jsonResponse(
  body: unknown,
  opts?: { status?: number; requestId?: string; headers?: Record<string, string> },
): NextResponse {
  const status = opts?.status ?? 200
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Request-Id',
    ...(opts?.requestId ? { 'X-Request-Id': opts.requestId } : {}),
    ...(opts?.headers ?? {}),
  }
  return NextResponse.json(body, { status, headers })
}

/** 错误响应（统一格式 { error, message, detail? }） */
export function errorResponse(e: unknown, requestId?: string): NextResponse {
  const err = toGatewayError(e)
  const body = err.toJSON()
  return jsonResponse(body, {
    status: err.httpStatus,
    requestId,
    headers: err.code === 'RATE_LIMITED' || err.code === 'QUOTA_EXCEEDED' ? { 'Retry-After': '60' } : {},
  })
}

/** OPTIONS 预检响应 */
export function corsPreflightResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Request-Id',
      'Access-Control-Max-Age': '86400',
    },
  })
}
