import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 多租户计量统计
 *   GET /api/admin/usage?tenantId=&days=7
 *   返回：各租户×日聚合 + 总览
 */
export const GET = withAdmin(async (req, ctx) => {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') ?? ''
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7), 1), 90)
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const sinceDate = since.toISOString().slice(0, 10)

  const where: any = { date: { gte: sinceDate } }
  if (tenantId) where.tenantId = tenantId

  const records = await db.usageRecord.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 5000,
  })

  // 总览聚合
  const summary = records.reduce(
    (acc, r) => {
      acc.searchCount += r.searchCount
      acc.errorCount += r.errorCount
      acc.rateLimitedCount += r.rateLimitedCount
      acc.rerankCount += r.rerankCount
      acc.unauthorizedCount += r.unauthorizedCount
      acc.embedTokens += r.embedTokens
      acc.rerankDocuments += r.rerankDocuments
      acc.resultChunks += r.resultChunks
      acc.latencySumMs += r.latencySumMs
      acc.latencyCount += r.latencyCount
      acc.latencyMaxMs = Math.max(acc.latencyMaxMs, r.latencyMaxMs)
      acc.rerankLatencySumMs += r.rerankLatencySumMs
      acc.rerankLatencyCount += r.rerankLatencyCount
      return acc
    },
    {
      searchCount: 0,
      errorCount: 0,
      rateLimitedCount: 0,
      rerankCount: 0,
      unauthorizedCount: 0,
      embedTokens: 0,
      rerankDocuments: 0,
      resultChunks: 0,
      latencySumMs: 0,
      latencyCount: 0,
      latencyMaxMs: 0,
      rerankLatencySumMs: 0,
      rerankLatencyCount: 0,
    },
  )

  // 按租户聚合
  const byTenant = new Map<string, any>()
  for (const r of records) {
    const t = byTenant.get(r.tenantId) ?? {
      tenantId: r.tenantId,
      searchCount: 0,
      errorCount: 0,
      rateLimitedCount: 0,
      rerankCount: 0,
      embedTokens: 0,
      rerankDocuments: 0,
      latencySumMs: 0,
      latencyCount: 0,
      latencyMaxMs: 0,
    }
    t.searchCount += r.searchCount
    t.errorCount += r.errorCount
    t.rateLimitedCount += r.rateLimitedCount
    t.rerankCount += r.rerankCount
    t.embedTokens += r.embedTokens
    t.rerankDocuments += r.rerankDocuments
    t.latencySumMs += r.latencySumMs
    t.latencyCount += r.latencyCount
    t.latencyMaxMs = Math.max(t.latencyMaxMs, r.latencyMaxMs)
    byTenant.set(r.tenantId, t)
  }

  // 关联租户名
  const tenantIds = [...byTenant.keys()]
  const tenants = await db.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } })
  const tenantMap = new Map(tenants.map((t) => [t.id, t]))
  const tenantStats = [...byTenant.values()].map((t) => ({
    ...t,
    tenant: tenantMap.get(t.tenantId) ?? null,
    avgLatencyMs: t.latencyCount > 0 ? Math.round(t.latencySumMs / t.latencyCount) : 0,
  }))

  return jsonResponse({
    days,
    sinceDate,
    summary: {
      ...summary,
      avgLatencyMs: summary.latencyCount > 0 ? Math.round(summary.latencySumMs / summary.latencyCount) : 0,
      avgRerankLatencyMs: summary.rerankLatencyCount > 0 ? Math.round(summary.rerankLatencySumMs / summary.rerankLatencyCount) : 0,
    },
    byTenant: tenantStats,
    daily: records.map((r) => ({
      tenantId: r.tenantId,
      date: r.date,
      searchCount: r.searchCount,
      errorCount: r.errorCount,
      rateLimitedCount: r.rateLimitedCount,
      rerankCount: r.rerankCount,
      latencyAvgMs: r.latencyCount > 0 ? Math.round(r.latencySumMs / r.latencyCount) : 0,
      latencyMaxMs: r.latencyMaxMs,
    })),
  })
})
