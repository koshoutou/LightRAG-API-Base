/**
 * 管理后台 API 客户端（浏览器端 fetch 封装）
 * 统一错误处理 + 类型定义
 */

export class ApiError extends Error {
  status: number
  code?: string
  detail?: unknown
  constructor(message: string, status: number, code?: string, detail?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

async function request<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  })
  const text = await res.text()
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError(text || `HTTP ${res.status}`, res.status)
  }
  if (!res.ok) {
    throw new ApiError(json?.message || json?.error || `HTTP ${res.status}`, res.status, json?.error, json?.detail)
  }
  return json as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface PlatformSettings {
  qdrant: { url: string; apiKeyConfigured: boolean; apiKeySource: string }
  embedding: {
    apiBase: string
    apiKeyConfigured: boolean
    model: string
    dim: number
    apiBaseSource: string
    reminder: string
  }
  rerank: { apiBase: string; apiKeyConfigured: boolean; model: string; apiBaseSource: string; reminder: string }
  defaults: {
    topK: number
    prefetchLimit: number
    mode: 'hybrid' | 'dense' | 'sparse'
    rerank: boolean
    fusion: 'rrf' | 'dbsf'
    rrfK: number
    rrfWeights: [number, number]
  }
  rateLimit: { defaultRatePerMin: number; defaultDailyQuota: number }
  retention: { callLogDays: number; rerankLogDays: number; auditLogDays: number }
  switches: { readonlyCircuitBreaker: boolean; allowCrossTenantKb: boolean }
}

export interface Tenant {
  id: string
  name: string
  slug: string
  enabled: boolean
  description: string
  ratePerMin: number
  dailyQuota: number
  contact: string
  metaJson: string
  createdAt: string
  _count?: { apiKeys: number; kbMappings: number }
}

export interface ApiKey {
  id: string
  tenantId: string
  name: string
  keyPrefix: string
  keyFormat: string
  role: 'readonly' | 'operator' | 'admin'
  enabled: boolean
  ratePerMinOverride: number
  dailyQuotaOverride: number
  expiresAt: string | null
  lastUsedAt: string | null
  callCount: number
  revokedAt: string | null
  createdAt: string
}

export interface KbMapping {
  id: string
  tenantId: string
  kbId: string
  collection: string
  name: string
  dim: number
  embeddingModel: string
  enabled: boolean
  createdAt: string
  tenant?: { name: string; slug: string }
}

export interface CallLog {
  id: string
  tenantId: string
  apiKeyId: string | null
  source: string
  kbId: string
  collection: string
  query: string
  mode: string
  topK: number
  prefetchLimit: number
  rerank: boolean
  fusion: string
  rrfK: number
  tookMs: number
  embedMs: number
  recallMs: number
  fusionMs: number
  rerankMs: number
  contextMs: number
  resultCount: number
  resultsJson: string
  embedFingerprintJson: string
  status: string
  httpStatus: number
  errorCode: string | null
  errorMessage: string | null
  clientIp: string
  userAgent: string
  requestId: string
  createdAt: string
  rerankLog?: RerankLog | null
  apiKey?: { name: string; keyPrefix: string } | null
  tenant?: { name: string; slug: string } | null
}

export interface RerankLog {
  id: string
  callLogId: string
  tenantId: string
  query: string
  candidatesJson: string
  resultsJson: string
  model: string
  topN: number
  tookMs: number
  providerRawJson: string
  provider: string
  createdAt: string
  callLog?: { kbId: string; collection: string; mode: string; topK: number; status: string; clientIp: string; requestId: string } | null
}

export interface AuditLog {
  id: string
  tenantId: string | null
  actor: string
  action: string
  targetType: string
  targetId: string | null
  beforeJson: string
  afterJson: string
  ip: string
  userAgent: string
  requestId: string
  createdAt: string
}

export interface UsageResponse {
  days: number
  sinceDate: string
  summary: {
    searchCount: number
    errorCount: number
    rateLimitedCount: number
    rerankCount: number
    unauthorizedCount: number
    embedTokens: number
    rerankDocuments: number
    resultChunks: number
    latencySumMs: number
    latencyCount: number
    latencyMaxMs: number
    rerankLatencySumMs: number
    rerankLatencyCount: number
    avgLatencyMs: number
    avgRerankLatencyMs: number
  }
  byTenant: Array<{
    tenantId: string
    searchCount: number
    errorCount: number
    rateLimitedCount: number
    rerankCount: number
    embedTokens: number
    rerankDocuments: number
    latencySumMs: number
    latencyCount: number
    latencyMaxMs: number
    tenant: { id: string; name: string; slug: string } | null
    avgLatencyMs: number
  }>
  daily: Array<{
    tenantId: string
    date: string
    searchCount: number
    errorCount: number
    rateLimitedCount: number
    rerankCount: number
    latencyAvgMs: number
    latencyMaxMs: number
  }>
}

export interface HealthResponse {
  status: string
  service: string
  version: string
  timestamp: string
  checks: {
    qdrant: { configured: boolean; reachable: boolean; version?: string }
    embedding: { configured: boolean; model: string | null; dim: number | null }
    rerank: { configured: boolean; model: string | null }
    circuitBreaker: string
  }
  defaults: Record<string, unknown>
  reminder: string
}
