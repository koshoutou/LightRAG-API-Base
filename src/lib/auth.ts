import { db } from './db'
import { sha256Hex, safeEqualHex, generateSessionToken } from './crypto'
import { GatewayError } from './errors'
import { randomBytes, pbkdf2Sync } from 'node:crypto'

export type ApiKeyRole = 'readonly' | 'operator' | 'admin'
const ROLE_RANK: Record<ApiKeyRole, number> = { readonly: 1, operator: 2, admin: 3 }

export interface AuthenticatedApiKey {
  id: string
  tenantId: string
  role: ApiKeyRole
  name: string
  ratePerMin: number // resolved
  dailyQuota: number // resolved
  tenant: {
    id: string
    name: string
    slug: string
    enabled: boolean
    ratePerMin: number
    dailyQuota: number
  }
}

/** 从 Authorization 头解析 Bearer token */
export function parseBearerAuth(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  return m ? m[1].trim() : null
}

/**
 * 鉴权 API Key —— 哈希比对，校验启用/过期/租户启用
 * 同时解析最终生效的限流配额（API Key override > 租户 > 平台默认）
 */
export async function authenticateApiKey(
  token: string,
  defaults: { ratePerMin: number; dailyQuota: number },
): Promise<AuthenticatedApiKey> {
  if (!token) throw new GatewayError('UNAUTHORIZED', '缺少 API Key')
  const hash = sha256Hex(token)
  const row = await db.apiKey.findUnique({
    where: { keyHash: hash },
    include: { tenant: true },
  })
  if (!row) throw new GatewayError('UNAUTHORIZED', '无效的 API Key')
  if (!row.enabled || row.revokedAt) throw new GatewayError('APIKEY_DISABLED', 'API Key 已被禁用')
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new GatewayError('APIKEY_EXPIRED', 'API Key 已过期')
  }
  if (!row.tenant?.enabled) throw new GatewayError('FORBIDDEN', '所属租户已被停用')

  // 解析生效配额（override > tenant > default；-1=无限）
  const resolveQuota = (override: number, tenant: number, def: number): number => {
    if (override === -1) return -1
    if (override > 0) return override
    if (tenant === -1) return -1
    if (tenant > 0) return tenant
    return def
  }
  const ratePerMin = resolveQuota(row.ratePerMinOverride, row.tenant.ratePerMin, defaults.ratePerMin)
  const dailyQuota = resolveQuota(row.dailyQuotaOverride, row.tenant.dailyQuota, defaults.dailyQuota)

  // 异步更新 lastUsedAt + callCount（不阻塞响应）
  void db.apiKey
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(), callCount: { increment: 1 } },
    })
    .catch(() => {})

  return {
    id: row.id,
    tenantId: row.tenantId,
    role: row.role as ApiKeyRole,
    name: row.name,
    ratePerMin,
    dailyQuota,
    tenant: {
      id: row.tenant.id,
      name: row.tenant.name,
      slug: row.tenant.slug,
      enabled: row.tenant.enabled,
      ratePerMin: row.tenant.ratePerMin,
      dailyQuota: row.tenant.dailyQuota,
    },
  }
}

/** 角色校验 */
export function requireRole(auth: AuthenticatedApiKey, min: ApiKeyRole): void {
  if (ROLE_RANK[auth.role] < ROLE_RANK[min]) {
    throw new GatewayError('FORBIDDEN', `需要 ${min} 及以上权限（当前 ${auth.role}）`)
  }
}

/**
 * 校验租户对 KB 的访问权 —— 查 KbMapping
 * allowCrossTenantKb=false 时，KB 必须归属请求租户
 */
export async function resolveKbAccess(
  auth: AuthenticatedApiKey,
  kbId: string,
  opts: { allowCrossTenant?: boolean },
): Promise<{ collection: string; dim: number; embeddingModel: string; name: string }> {
  // 先查本租户
  let mapping = await db.kbMapping.findFirst({
    where: { tenantId: auth.tenantId, kbId, enabled: true },
  })
  if (!mapping && opts.allowCrossTenant) {
    // 跨租户共享：任意租户的可用映射
    mapping = await db.kbMapping.findFirst({ where: { kbId, enabled: true } })
  }
  if (!mapping) {
    throw new GatewayError('KB_NOT_REGISTERED', `知识库 ${kbId} 未注册到当前租户`, {
      meta: { kbId, tenantId: auth.tenantId, hint: '请在管理后台「知识库映射」注册' },
    })
  }
  if (!mapping.enabled) throw new GatewayError('KB_DISABLED', `知识库 ${mapping.name || kbId} 已停用`)
  return {
    collection: mapping.collection,
    dim: mapping.dim,
    embeddingModel: mapping.embeddingModel,
    name: mapping.name,
  }
}

// ---------------------------------------------------------------------------
// 管理后台会话
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'lra_admin'
const SESSION_TTL_MS = 1000 * 60 * 60 * 12 // 12h

export interface AdminAuth {
  userId: string
  username: string
  role: 'admin' | 'viewer'
  sessionId: string
}

/** 从请求 cookie 解析管理后台会话 */
export async function parseAdminSession(cookieHeader: string | null): Promise<AdminAuth | null> {
  if (!cookieHeader) return null
  const token = parseCookieValue(cookieHeader, SESSION_COOKIE)
  if (!token) return null
  const hash = sha256Hex(token)
  const sess = await db.adminSession.findUnique({ where: { tokenHash: hash } })
  if (!sess) return null
  if (sess.revokedAt) return null
  if (sess.expiresAt.getTime() < Date.now()) return null
  const user = await db.adminUser.findUnique({ where: { id: sess.subject } })
  if (!user || !user.enabled) return null
  return {
    userId: user.id,
    username: user.username,
    role: user.role as 'admin' | 'viewer',
    sessionId: sess.id,
  }
}

/** 创建管理后台会话 */
export async function createAdminSession(
  userId: string,
  opts?: { ip?: string; userAgent?: string; issuedBy?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const { raw, hash } = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.adminSession.create({
    data: {
      tokenHash: hash,
      subject: userId,
      issuedBy: opts?.issuedBy ?? 'password',
      expiresAt,
      ip: opts?.ip ?? '',
      userAgent: opts?.userAgent ?? '',
    },
  })
  return { token: raw, expiresAt }
}

/** 注销管理后台会话 */
export async function revokeAdminSession(token: string): Promise<void> {
  const hash = sha256Hex(token)
  await db.adminSession.updateMany({
    where: { tokenHash: hash },
    data: { revokedAt: new Date() },
  })
}

export const ADMIN_SESSION_COOKIE = SESSION_COOKIE

// ---------------------------------------------------------------------------
// 管理员密码哈希（PBKDF2-SHA256, 100k 迭代, 16B 盐）
// ---------------------------------------------------------------------------

export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, s, 100_000, 32, 'sha256').toString('hex')
  return `pbkdf2$100000$${s}$${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const salt = parts[2]
  const expected = parts[3]
  const actual = pbkdf2Sync(password, salt, Number(parts[1]) || 100_000, 32, 'sha256').toString('hex')
  return safeEqualHex(actual, expected)
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function parseCookieValue(cookieHeader: string, name: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${name}=([^;]+)`).exec(cookieHeader)
  return m ? decodeURIComponent(m[1].trim()) : null
}
