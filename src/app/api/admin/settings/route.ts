import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { invalidateSettingsCache, loadSettings } from '@/lib/config'
import { writeAudit } from '@/lib/audit'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SettingUpdate = z.object({
  qdrantUrl: z.string().max(512).optional(),
  qdrantApiKey: z.string().max(512).optional(),
  embedApiBase: z.string().max(512).optional(),
  embedApiKey: z.string().max(512).optional(),
  embedModel: z.string().max(128).optional(),
  embedDim: z.number().int().min(0).max(8192).optional(),
  rerankApiBase: z.string().max(512).optional(),
  rerankApiKey: z.string().max(512).optional(),
  rerankModel: z.string().max(128).optional(),
  defaultTopK: z.number().int().min(1).max(50).optional(),
  defaultPrefetchLimit: z.number().int().min(1).max(200).optional(),
  defaultMode: z.enum(['hybrid', 'dense', 'sparse']).optional(),
  defaultRerank: z.boolean().optional(),
  defaultFusion: z.enum(['rrf', 'dbsf']).optional(),
  defaultRrfK: z.number().int().min(1).max(1000).optional(),
  defaultRrfWeights: z.array(z.number()).length(2).optional(),
  defaultRatePerMin: z.number().int().min(0).optional(),
  defaultDailyQuota: z.number().int().min(-1).optional(),
  callLogRetentionDays: z.number().int().min(1).max(3650).optional(),
  rerankLogRetentionDays: z.number().int().min(1).max(3650).optional(),
  auditLogRetentionDays: z.number().int().min(1).max(36500).optional(),
  readonlyCircuitBreaker: z.boolean().optional(),
  allowCrossTenantKb: z.boolean().optional(),
})

/** 获取设置（脱敏：API Key 仅返回是否已配置） */
export const GET = withAdmin(async (req, ctx) => {
  const settings = await loadSettings()
  return jsonResponse({
    qdrant: {
      url: settings.qdrantUrl,
      apiKeyConfigured: Boolean(settings.qdrantApiKey),
      apiKeySource: settings.sources.qdrantUrl,
    },
    embedding: {
      apiBase: settings.embedApiBase,
      apiKeyConfigured: Boolean(settings.embedApiKey),
      model: settings.embedModel,
      dim: settings.embedDim,
      apiBaseSource: settings.sources.embedApiBase,
      reminder:
        '⚠ 嵌入模型必须与向量入库时完全一致（同 API Base + 同 Model + 同 维度）。入库侧以 LightRAG-Base 知识库设置为准；不一致会导致向量空间不匹配，召回无意义。',
    },
    rerank: {
      apiBase: settings.rerankApiBase,
      apiKeyConfigured: Boolean(settings.rerankApiKey),
      model: settings.rerankModel,
      apiBaseSource: settings.sources.rerankApiBase,
      reminder:
        '⚠ 重排模型必须与入库/检索侧使用的重排模型一致，否则重排序结果不可对比。',
    },
    defaults: {
      topK: settings.defaultTopK,
      prefetchLimit: settings.defaultPrefetchLimit,
      mode: settings.defaultMode,
      rerank: settings.defaultRerank,
      fusion: settings.defaultFusion,
      rrfK: settings.defaultRrfK,
      rrfWeights: settings.defaultRrfWeights,
    },
    rateLimit: {
      defaultRatePerMin: settings.defaultRatePerMin,
      defaultDailyQuota: settings.defaultDailyQuota,
    },
    retention: {
      callLogDays: settings.callLogRetentionDays,
      rerankLogDays: settings.rerankLogRetentionDays,
      auditLogDays: settings.auditLogRetentionDays,
    },
    switches: {
      readonlyCircuitBreaker: settings.readonlyCircuitBreaker,
      allowCrossTenantKb: settings.allowCrossTenantKb,
    },
  })
})

/** 更新设置 */
export const PUT = withAdmin(async (req, ctx) => {
  const body = SettingUpdate.parse(await req.json())
  // 取旧值用于审计 diff
  const before = await db.setting.findUnique({ where: { id: 'default' } })
  const rrw = body.defaultRrfWeights ? JSON.stringify(body.defaultRrfWeights) : undefined
  const updated = await db.setting.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      qdrantUrl: body.qdrantUrl ?? '',
      qdrantApiKey: body.qdrantApiKey ?? '',
      embedApiBase: body.embedApiBase ?? '',
      embedApiKey: body.embedApiKey ?? '',
      embedModel: body.embedModel ?? '',
      embedDim: body.embedDim ?? 0,
      rerankApiBase: body.rerankApiBase ?? '',
      rerankApiKey: body.rerankApiKey ?? '',
      rerankModel: body.rerankModel ?? '',
      defaultTopK: body.defaultTopK ?? 5,
      defaultPrefetchLimit: body.defaultPrefetchLimit ?? 50,
      defaultMode: body.defaultMode ?? 'hybrid',
      defaultRerank: body.defaultRerank ?? false,
      defaultFusion: body.defaultFusion ?? 'rrf',
      defaultRrfK: body.defaultRrfK ?? 60,
      defaultRrfWeights: rrw ?? '[0.5,0.5]',
      defaultRatePerMin: body.defaultRatePerMin ?? 60,
      defaultDailyQuota: body.defaultDailyQuota ?? 10000,
      callLogRetentionDays: body.callLogRetentionDays ?? 30,
      rerankLogRetentionDays: body.rerankLogRetentionDays ?? 30,
      auditLogRetentionDays: body.auditLogRetentionDays ?? 365,
      readonlyCircuitBreaker: body.readonlyCircuitBreaker ?? false,
      allowCrossTenantKb: body.allowCrossTenantKb ?? false,
    },
    update: {
      ...(body.qdrantUrl !== undefined ? { qdrantUrl: body.qdrantUrl } : {}),
      ...(body.qdrantApiKey !== undefined ? { qdrantApiKey: body.qdrantApiKey } : {}),
      ...(body.embedApiBase !== undefined ? { embedApiBase: body.embedApiBase } : {}),
      ...(body.embedApiKey !== undefined ? { embedApiKey: body.embedApiKey } : {}),
      ...(body.embedModel !== undefined ? { embedModel: body.embedModel } : {}),
      ...(body.embedDim !== undefined ? { embedDim: body.embedDim } : {}),
      ...(body.rerankApiBase !== undefined ? { rerankApiBase: body.rerankApiBase } : {}),
      ...(body.rerankApiKey !== undefined ? { rerankApiKey: body.rerankApiKey } : {}),
      ...(body.rerankModel !== undefined ? { rerankModel: body.rerankModel } : {}),
      ...(body.defaultTopK !== undefined ? { defaultTopK: body.defaultTopK } : {}),
      ...(body.defaultPrefetchLimit !== undefined ? { defaultPrefetchLimit: body.defaultPrefetchLimit } : {}),
      ...(body.defaultMode !== undefined ? { defaultMode: body.defaultMode } : {}),
      ...(body.defaultRerank !== undefined ? { defaultRerank: body.defaultRerank } : {}),
      ...(body.defaultFusion !== undefined ? { defaultFusion: body.defaultFusion } : {}),
      ...(body.defaultRrfK !== undefined ? { defaultRrfK: body.defaultRrfK } : {}),
      ...(rrw !== undefined ? { defaultRrfWeights: rrw } : {}),
      ...(body.defaultRatePerMin !== undefined ? { defaultRatePerMin: body.defaultRatePerMin } : {}),
      ...(body.defaultDailyQuota !== undefined ? { defaultDailyQuota: body.defaultDailyQuota } : {}),
      ...(body.callLogRetentionDays !== undefined ? { callLogRetentionDays: body.callLogRetentionDays } : {}),
      ...(body.rerankLogRetentionDays !== undefined ? { rerankLogRetentionDays: body.rerankLogRetentionDays } : {}),
      ...(body.auditLogRetentionDays !== undefined ? { auditLogRetentionDays: body.auditLogRetentionDays } : {}),
      ...(body.readonlyCircuitBreaker !== undefined ? { readonlyCircuitBreaker: body.readonlyCircuitBreaker } : {}),
      ...(body.allowCrossTenantKb !== undefined ? { allowCrossTenantKb: body.allowCrossTenantKb } : {}),
    },
    select: { id: true },
  })
  invalidateSettingsCache()
  writeAudit({
    actor: `admin:${ctx.admin.userId}`,
    action: 'setting.update',
    targetType: 'setting',
    targetId: 'default',
    beforeJson: before
      ? {
          qdrantUrl: before.qdrantUrl,
          embedModel: before.embedModel,
          rerankModel: before.rerankModel,
          readonlyCircuitBreaker: before.readonlyCircuitBreaker,
        }
      : {},
    afterJson: {
      qdrantUrl: body.qdrantUrl,
      embedModel: body.embedModel,
      rerankModel: body.rerankModel,
      readonlyCircuitBreaker: body.readonlyCircuitBreaker,
    },
    ip: ctx.clientIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  })
  return jsonResponse({ ok: true, id: updated.id })
}, { role: 'admin' })
