/**
 * 类型化错误 —— 网关统一错误模型
 * 每个错误带 HTTP 状态、错误码、是否计费、是否审计
 */

export type GatewayErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'APIKEY_DISABLED'
  | 'APIKEY_EXPIRED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'CIRCUIT_OPEN'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'KB_NOT_REGISTERED'
  | 'KB_DISABLED'
  | 'SETTING_MISSING'
  | 'EMBED_FAILED'
  | 'RERANK_FAILED'
  | 'QDRANT_UNREACHABLE'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL'

const HTTP_MAP: Record<GatewayErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  APIKEY_DISABLED: 403,
  APIKEY_EXPIRED: 403,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  CIRCUIT_OPEN: 503,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  KB_NOT_REGISTERED: 404,
  KB_DISABLED: 403,
  SETTING_MISSING: 503,
  EMBED_FAILED: 502,
  RERANK_FAILED: 502,
  QDRANT_UNREACHABLE: 502,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
}

/** 是否计入错误计量 */
const BILLABLE: Set<GatewayErrorCode> = new Set([
  'BAD_REQUEST',
  'NOT_FOUND',
  'KB_NOT_REGISTERED',
  'KB_DISABLED',
])

/** 是否写入审计日志（安全相关） */
const AUDITABLE: Set<GatewayErrorCode> = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'APIKEY_DISABLED',
  'APIKEY_EXPIRED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
])

export class GatewayError extends Error {
  code: GatewayErrorCode
  httpStatus: number
  billable: boolean
  auditable: boolean
  cause?: unknown
  meta?: Record<string, unknown>

  constructor(
    code: GatewayErrorCode,
    message: string,
    opts?: { cause?: unknown; meta?: Record<string, unknown> },
  ) {
    super(message)
    this.name = 'GatewayError'
    this.code = code
    this.httpStatus = HTTP_MAP[code]
    this.billable = BILLABLE.has(code)
    this.auditable = AUDITABLE.has(code)
    this.cause = opts?.cause
    this.meta = opts?.meta
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      ...(this.meta && Object.keys(this.meta).length ? { detail: this.meta } : {}),
    }
  }
}

export function isGatewayError(e: unknown): e is GatewayError {
  return e instanceof GatewayError
}

export function toGatewayError(e: unknown): GatewayError {
  if (e instanceof GatewayError) return e
  const msg = e instanceof Error ? e.message : String(e)
  return new GatewayError('INTERNAL', msg, { cause: e })
}
