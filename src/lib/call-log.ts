import { db } from './db'

/**
 * 调用日志 + 重排序结果日志写入器
 * 每次检索请求一条 CallLog；rerank=true 时附加 RerankLog
 * 日志保留期到期由 cron 清理（见 lib/retention.ts）
 */

export interface CallLogEntry {
  tenantId: string
  apiKeyId?: string | null
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
  rrfWeightsJson: string
  filterJson: string
  debugJson: string
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
  errorCode?: string | null
  errorMessage?: string | null
  clientIp: string
  userAgent: string
  requestId: string
}

export interface RerankLogEntry {
  tenantId: string
  query: string
  candidatesJson: string
  resultsJson: string
  model: string
  topN: number
  tookMs: number
  providerRawJson: string
  provider: string
}

/** 写一条调用日志，返回 callLogId（用于关联 RerankLog） */
export async function writeCallLog(entry: CallLogEntry): Promise<string> {
  const row = await db.callLog.create({
    data: {
      tenantId: entry.tenantId,
      apiKeyId: entry.apiKeyId ?? null,
      source: entry.source,
      kbId: entry.kbId,
      collection: entry.collection,
      query: entry.query,
      mode: entry.mode,
      topK: entry.topK,
      prefetchLimit: entry.prefetchLimit,
      rerank: entry.rerank,
      fusion: entry.fusion,
      rrfK: entry.rrfK,
      rrfWeightsJson: entry.rrfWeightsJson,
      filterJson: entry.filterJson,
      debugJson: entry.debugJson,
      tookMs: entry.tookMs,
      embedMs: entry.embedMs,
      recallMs: entry.recallMs,
      fusionMs: entry.fusionMs,
      rerankMs: entry.rerankMs,
      contextMs: entry.contextMs,
      resultCount: entry.resultCount,
      resultsJson: entry.resultsJson,
      embedFingerprintJson: entry.embedFingerprintJson,
      status: entry.status,
      httpStatus: entry.httpStatus,
      errorCode: entry.errorCode ?? null,
      errorMessage: entry.errorMessage ?? null,
      clientIp: entry.clientIp,
      userAgent: entry.userAgent,
      requestId: entry.requestId,
    },
    select: { id: true },
  })
  return row.id
}

/** 写重排序结果日志（关联 callLogId） */
export async function writeRerankLog(callLogId: string, entry: RerankLogEntry): Promise<void> {
  await db.rerankLog.create({
    data: {
      callLogId,
      tenantId: entry.tenantId,
      query: entry.query,
      candidatesJson: entry.candidatesJson,
      resultsJson: entry.resultsJson,
      model: entry.model,
      topN: entry.topN,
      tookMs: entry.tookMs,
      providerRawJson: entry.providerRawJson,
      provider: entry.provider,
    },
  })
}

/**
 * 计量增量（按租户 × 日聚合）
 * 使用 upsert 保证幂等
 */
export async function incrementUsage(
  tenantId: string,
  fields: {
    searchCount?: number
    errorCount?: number
    rateLimitedCount?: number
    rerankCount?: number
    unauthorizedCount?: number
    embedTokens?: number
    rerankDocuments?: number
    resultChunks?: number
    latencyMs?: number
    rerankLatencyMs?: number
  },
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  await db.usageRecord
    .upsert({
      where: { tenantId_date: { tenantId, date } },
      create: {
        tenantId,
        date,
        searchCount: fields.searchCount ?? 0,
        errorCount: fields.errorCount ?? 0,
        rateLimitedCount: fields.rateLimitedCount ?? 0,
        rerankCount: fields.rerankCount ?? 0,
        unauthorizedCount: fields.unauthorizedCount ?? 0,
        embedTokens: fields.embedTokens ?? 0,
        rerankDocuments: fields.rerankDocuments ?? 0,
        resultChunks: fields.resultChunks ?? 0,
        latencySumMs: fields.latencyMs ?? 0,
        latencyCount: fields.latencyMs != null ? 1 : 0,
        latencyMaxMs: fields.latencyMs ?? 0,
        rerankLatencySumMs: fields.rerankLatencyMs ?? 0,
        rerankLatencyCount: fields.rerankLatencyMs != null ? 1 : 0,
      },
      update: {
        searchCount: { increment: fields.searchCount ?? 0 },
        errorCount: { increment: fields.errorCount ?? 0 },
        rateLimitedCount: { increment: fields.rateLimitedCount ?? 0 },
        rerankCount: { increment: fields.rerankCount ?? 0 },
        unauthorizedCount: { increment: fields.unauthorizedCount ?? 0 },
        embedTokens: { increment: fields.embedTokens ?? 0 },
        rerankDocuments: { increment: fields.rerankDocuments ?? 0 },
        resultChunks: { increment: fields.resultChunks ?? 0 },
        latencySumMs: { increment: fields.latencyMs ?? 0 },
        latencyCount: { increment: fields.latencyMs != null ? 1 : 0 },
        rerankLatencySumMs: { increment: fields.rerankLatencyMs ?? 0 },
        rerankLatencyCount: { increment: fields.rerankLatencyMs != null ? 1 : 0 },
      },
    })
    .catch(() => {})
}

// latencyMaxMs 需要在 update 后单独更新（取 max），这里做一次补偿更新
export async function bumpLatencyMax(tenantId: string, latencyMs: number, rerankLatencyMs?: number): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const row = await db.usageRecord.findUnique({ where: { tenantId_date: { tenantId, date } } })
  if (!row) return
  const patch: any = {}
  if (latencyMs > row.latencyMaxMs) patch.latencyMaxMs = latencyMs
  if (patch.latencyMaxMs !== undefined || rerankLatencyMs !== undefined) {
    await db.usageRecord.update({ where: { id: row.id }, data: patch }).catch(() => {})
  }
}
