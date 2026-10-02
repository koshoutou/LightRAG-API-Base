import { db } from './db'

/**
 * 配置加载器 —— DB Setting 为主，.env 为引导兜底
 * 设计原则：
 *  - 运行时配置以 DB 为准（管理后台可热改，无需重启）
 *  - .env 仅在 DB 行不存在或字段空时兜底（首次部署引导）
 *  - 内存缓存 3s，避免每次请求查库
 */

export interface PlatformSettings {
  // Qdrant
  qdrantUrl: string
  qdrantApiKey: string
  // Embedding
  embedApiBase: string
  embedApiKey: string
  embedModel: string
  embedDim: number
  // Rerank
  rerankApiBase: string
  rerankApiKey: string
  rerankModel: string
  // Defaults
  defaultTopK: number
  defaultPrefetchLimit: number
  defaultMode: 'hybrid' | 'dense' | 'sparse'
  defaultRerank: boolean
  defaultFusion: 'rrf' | 'dbsf'
  defaultRrfK: number
  defaultRrfWeights: [number, number]
  // Rate limit
  defaultRatePerMin: number
  defaultDailyQuota: number
  // Retention
  callLogRetentionDays: number
  rerankLogRetentionDays: number
  auditLogRetentionDays: number
  // Switches
  readonlyCircuitBreaker: boolean
  allowCrossTenantKb: boolean
  // 来源标记（用于审计：哪些值来自 env 兜底）
  sources: {
    qdrantUrl: 'db' | 'env'
    embedApiBase: 'db' | 'env'
    rerankApiBase: 'db' | 'env'
  }
}

const ENV = process.env

function pick(dbVal: string, envVal: string | undefined): { val: string; src: 'db' | 'env' } {
  if (dbVal && dbVal.trim()) return { val: dbVal.trim(), src: 'db' }
  if (envVal && envVal.trim()) return { val: envVal.trim(), src: 'env' }
  return { val: '', src: 'db' }
}

let cache: { ts: number; settings: PlatformSettings } | null = null
const CACHE_TTL_MS = 3_000

/** 加载平台设置（DB 优先，env 兜底，3s 内存缓存） */
export async function loadSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.settings
  }
  const row = await db.setting.findUnique({ where: { id: 'default' } })

  const qUrl = pick(row?.qdrantUrl ?? '', ENV.QDRANT_URL)
  const qKey = pick(row?.qdrantApiKey ?? '', ENV.QDRANT_API_KEY)
  const eBase = pick(row?.embedApiBase ?? '', ENV.EMBED_API_BASE)
  const eKey = pick(row?.embedApiKey ?? '', ENV.EMBED_API_KEY)
  const eModel = pick(row?.embedModel ?? '', ENV.EMBED_MODEL)
  const rBase = pick(row?.rerankApiBase ?? '', ENV.RERANK_API_BASE)
  const rKey = pick(row?.rerankApiKey ?? '', ENV.RERANK_API_KEY)
  const rModel = pick(row?.rerankModel ?? '', ENV.RERANK_MODEL)

  // 解析 RRF 权重
  let rrfWeights: [number, number] = [0.5, 0.5]
  try {
    const parsed = JSON.parse(row?.defaultRrfWeights || '[0.5,0.5]')
    if (Array.isArray(parsed) && parsed.length === 2) {
      rrfWeights = [Number(parsed[0]), Number(parsed[1])]
    }
  } catch {
    /* keep default */
  }

  // env 兜底 dim
  const embedDim = row?.embedDim && row.embedDim > 0 ? row.embedDim : Number(ENV.EMBED_DIM) || 0

  const settings: PlatformSettings = {
    qdrantUrl: qUrl.val,
    qdrantApiKey: qKey.val,
    embedApiBase: eBase.val,
    embedApiKey: eKey.val,
    embedModel: eModel.val,
    embedDim,
    rerankApiBase: rBase.val,
    rerankApiKey: rKey.val,
    rerankModel: rModel.val,
    defaultTopK: row?.defaultTopK ?? 5,
    defaultPrefetchLimit: row?.defaultPrefetchLimit ?? 50,
    defaultMode: (row?.defaultMode as 'hybrid' | 'dense' | 'sparse') || 'hybrid',
    defaultRerank: row?.defaultRerank ?? false,
    defaultFusion: (row?.defaultFusion as 'rrf' | 'dbsf') || 'rrf',
    defaultRrfK: row?.defaultRrfK ?? 60,
    defaultRrfWeights: rrfWeights,
    defaultRatePerMin: row?.defaultRatePerMin ?? 60,
    defaultDailyQuota: row?.defaultDailyQuota ?? 10000,
    callLogRetentionDays: row?.callLogRetentionDays ?? 30,
    rerankLogRetentionDays: row?.rerankLogRetentionDays ?? 30,
    auditLogRetentionDays: row?.auditLogRetentionDays ?? 365,
    readonlyCircuitBreaker: row?.readonlyCircuitBreaker ?? false,
    allowCrossTenantKb: row?.allowCrossTenantKb ?? false,
    sources: {
      qdrantUrl: qUrl.src,
      embedApiBase: eBase.src,
      rerankApiBase: rBase.src,
    },
  }

  cache = { ts: Date.now(), settings }
  return settings
}

/** 强制刷新缓存（管理后台改设置后调用） */
export function invalidateSettingsCache(): void {
  cache = null
}

/** 是否已配置 Qdrant（检索前置条件） */
export async function hasQdrantConfigured(s?: PlatformSettings): Promise<boolean> {
  const settings = s ?? (await loadSettings())
  return Boolean(settings.qdrantUrl)
}

/** 是否已配置 Embedding */
export async function hasEmbeddingConfigured(s?: PlatformSettings): Promise<boolean> {
  const settings = s ?? (await loadSettings())
  return Boolean(settings.embedApiBase && settings.embedModel)
}

/** 是否已配置 Rerank */
export async function hasRerankConfigured(s?: PlatformSettings): Promise<boolean> {
  const settings = s ?? (await loadSettings())
  return Boolean(settings.rerankApiBase && settings.rerankModel)
}
