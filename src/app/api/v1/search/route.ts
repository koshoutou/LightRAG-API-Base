import { NextRequest } from 'next/server'
import { authenticateApiKey, parseBearerAuth, resolveKbAccess, requireRole } from '@/lib/auth'
import { loadSettings } from '@/lib/config'
import { consume, gcMaybe } from '@/lib/rate-limit'
import { runSearch } from '@/lib/search'
import { writeCallLog, writeRerankLog, incrementUsage, bumpLatencyMax } from '@/lib/call-log'
import { writeAudit } from '@/lib/audit'
import { inc, observe } from '@/lib/prometheus'
import { GatewayError, toGatewayError } from '@/lib/errors'
import { getClientIp, getRequestId, jsonResponse, errorResponse, corsPreflightResponse } from '@/lib/http'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SearchBody = z.object({
  kbId: z.string().min(1),
  query: z.string().min(1).max(4096),
  topK: z.number().int().min(1).max(50).optional(),
  mode: z.enum(['hybrid', 'dense', 'sparse']).optional(),
  rerank: z.boolean().optional(),
  prefetchLimit: z.number().int().min(1).max(200).optional(),
  filter: z
    .object({
      docIds: z.array(z.string()).optional(),
      pageRange: z.tuple([z.number().int(), z.number().int()]).optional(),
    })
    .optional(),
  withParentContext: z.boolean().optional(),
  debug: z
    .object({
      fusion: z.enum(['rrf', 'dbsf']).optional(),
      rrfK: z.number().int().min(1).max(1000).optional(),
      rrfWeights: z.tuple([z.number(), z.number()]).optional(),
      prefetchLimit: z.number().int().min(1).max(200).optional(),
    })
    .optional(),
})

export async function OPTIONS() {
  return corsPreflightResponse()
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const clientIp = getClientIp(req)
  const userAgent = req.headers.get('user-agent') ?? ''
  gcMaybe()

  let tenantId = ''
  let apiKeyId: string | null = null
  const startedAt = Date.now()

  try {
    const settings = await loadSettings()

    if (settings.readonlyCircuitBreaker) {
      throw new GatewayError('CIRCUIT_OPEN', '检索熔断已开启（运维止血），请稍后重试', { meta: { requestId } })
    }

    const token = parseBearerAuth(req.headers.get('authorization'))
    if (!token) {
      inc('lra_requests_total', { status: 'unauthorized' })
      throw new GatewayError('UNAUTHORIZED', '缺少 Authorization: Bearer <ApiKey>')
    }
    const auth = await authenticateApiKey(token, {
      ratePerMin: settings.defaultRatePerMin,
      dailyQuota: settings.defaultDailyQuota,
    })
    tenantId = auth.tenantId
    apiKeyId = auth.id

    let parsedBody: z.infer<typeof SearchBody>
    try {
      const raw = await req.json()
      if (raw.debug !== undefined) requireRole(auth, 'operator')
      parsedBody = SearchBody.parse(raw)
    } catch (e: any) {
      const msg = e?.errors ? JSON.stringify(e.errors).slice(0, 300) : e?.message ?? '请求体非法'
      throw new GatewayError('BAD_REQUEST', `请求参数校验失败：${msg}`)
    }

    const kb = await resolveKbAccess(auth, parsedBody.kbId, { allowCrossTenant: settings.allowCrossTenantKb })

    const rl = consume({
      tenantId: auth.tenantId,
      apiKeyId: auth.id,
      ratePerMin: auth.ratePerMin,
      dailyQuota: auth.dailyQuota,
    })
    if (!rl.allowed) {
      inc('lra_requests_total', { status: 'ratelimited' })
      incrementUsage(auth.tenantId, { rateLimitedCount: 1 }).catch(() => {})
      const code = rl.reason === 'daily_quota' ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED'
      throw new GatewayError(
        code,
        rl.reason === 'daily_quota'
          ? `已达日配额上限（${rl.limitDay} 次/天）`
          : `请求过于频繁（${rl.limitPerMin}/分钟），请稍后重试`,
        { meta: { retryAfterMs: rl.retryAfterMs, currentPerMin: rl.currentPerMin, currentDay: rl.currentDay } },
      )
    }

    const { response, internals } = await runSearch({
      kbId: parsedBody.kbId,
      collection: kb.collection,
      query: parsedBody.query,
      topK: parsedBody.topK,
      mode: parsedBody.mode,
      rerank: parsedBody.rerank,
      prefetchLimit: parsedBody.prefetchLimit,
      filter: parsedBody.filter,
      withParentContext: parsedBody.withParentContext,
      debug: parsedBody.debug,
      settings,
      kbDim: kb.dim,
      kbEmbeddingModel: kb.embeddingModel,
    })

    const tookMs = Date.now() - startedAt
    observe('lra_search_latency_ms', tookMs)
    inc('lra_requests_total', { status: 'ok', mode: parsedBody.mode ?? settings.defaultMode })
    inc('lra_results_total', { mode: parsedBody.mode ?? settings.defaultMode }, response.results.length)

    const callLogId = await writeCallLog({
      tenantId: auth.tenantId,
      apiKeyId: auth.id,
      source: 'external',
      kbId: parsedBody.kbId,
      collection: kb.collection,
      query: parsedBody.query,
      mode: parsedBody.mode ?? settings.defaultMode,
      topK: parsedBody.topK ?? settings.defaultTopK,
      prefetchLimit: parsedBody.prefetchLimit ?? settings.defaultPrefetchLimit,
      rerank: parsedBody.rerank ?? settings.defaultRerank,
      fusion: internals.fusionUsed,
      rrfK: internals.rrfKUsed,
      rrfWeightsJson: JSON.stringify(internals.weightsUsed),
      filterJson: JSON.stringify(parsedBody.filter ?? {}),
      debugJson: JSON.stringify(parsedBody.debug ?? {}),
      tookMs,
      embedMs: response.stages.embedMs,
      recallMs: response.stages.recallMs,
      fusionMs: response.stages.fusionMs,
      rerankMs: response.stages.rerankMs,
      contextMs: response.stages.contextMs,
      resultCount: response.results.length,
      resultsJson: JSON.stringify(
        response.results.map((h) => ({
          chunkId: h.chunkId,
          score: h.score,
          rerankScore: h.rerankScore,
          docId: h.source.docId,
          page: h.source.page,
          docType: h.source.docType,
        })),
      ),
      embedFingerprintJson: JSON.stringify({
        dim: internals.embedDim,
        denseHash: internals.denseHash,
        sparseNnz: internals.sparseNnz,
        provider: internals.embedProvider,
        model: internals.embedModel,
      }),
      status: 'ok',
      httpStatus: 200,
      clientIp,
      userAgent,
      requestId,
    }).catch(() => '')

    if ((parsedBody.rerank ?? settings.defaultRerank) && internals.rerankOutput.length > 0 && callLogId) {
      await writeRerankLog(callLogId, {
        tenantId: auth.tenantId,
        query: parsedBody.query,
        candidatesJson: JSON.stringify(
          internals.rerankInput.map((c) => ({
            chunkId: c.chunkId,
            preview: c.text.slice(0, 120),
            prevRank: c.prevRank,
            prevScore: c.prevScore,
          })),
        ),
        resultsJson: JSON.stringify(internals.rerankOutput),
        model: internals.rerankModel ?? '',
        topN: internals.rerankOutput.length,
        tookMs: internals.rerankTookMs ?? 0,
        providerRawJson: JSON.stringify(internals.rerankRaw ?? {}).slice(0, 8192),
        provider: 'openai-compatible',
      }).catch(() => {})
    }

    incrementUsage(auth.tenantId, {
      searchCount: 1,
      rerankCount: (parsedBody.rerank ?? settings.defaultRerank) ? 1 : 0,
      embedTokens: Math.ceil(parsedBody.query.length / 4),
      rerankDocuments: (parsedBody.rerank ?? settings.defaultRerank) ? internals.rerankInput.length : 0,
      resultChunks: response.results.length,
      latencyMs: tookMs,
      rerankLatencyMs: (parsedBody.rerank ?? settings.defaultRerank) ? response.stages.rerankMs : undefined,
    }).catch(() => {})
    bumpLatencyMax(auth.tenantId, tookMs).catch(() => {})

    return jsonResponse(response, { requestId })
  } catch (e) {
    const err = toGatewayError(e)
    const tookMs = Date.now() - startedAt
    observe('lra_search_latency_ms', tookMs)
    inc('lra_requests_total', {
      status:
        err.code === 'UNAUTHORIZED'
          ? 'unauthorized'
          : err.code === 'RATE_LIMITED' || err.code === 'QUOTA_EXCEEDED'
            ? 'ratelimited'
            : 'error',
    })

    if (tenantId) {
      writeCallLog({
        tenantId,
        apiKeyId,
        source: 'external',
        kbId: '',
        collection: '',
        query: '',
        mode: '',
        topK: 0,
        prefetchLimit: 0,
        rerank: false,
        fusion: '',
        rrfK: 0,
        rrfWeightsJson: '[]',
        filterJson: '{}',
        debugJson: '{}',
        tookMs,
        embedMs: 0,
        recallMs: 0,
        fusionMs: 0,
        rerankMs: 0,
        contextMs: 0,
        resultCount: 0,
        resultsJson: '[]',
        embedFingerprintJson: '{}',
        status:
          err.code === 'UNAUTHORIZED'
            ? 'unauthorized'
            : err.code === 'RATE_LIMITED' || err.code === 'QUOTA_EXCEEDED'
              ? 'ratelimited'
              : 'error',
        httpStatus: err.httpStatus,
        errorCode: err.code,
        errorMessage: err.message.slice(0, 500),
        clientIp,
        userAgent,
        requestId,
      }).catch(() => {})
      incrementUsage(tenantId, {
        errorCount: 1,
        unauthorizedCount: err.code === 'UNAUTHORIZED' ? 1 : 0,
        rateLimitedCount: err.code === 'RATE_LIMITED' || err.code === 'QUOTA_EXCEEDED' ? 1 : 0,
      }).catch(() => {})
    }

    if (err.auditable) {
      writeAudit({
        tenantId: tenantId || null,
        actor: apiKeyId ? `apikey:${apiKeyId}` : 'anonymous',
        action: `request.${err.code.toLowerCase()}`,
        targetType: 'request',
        ip: clientIp,
        userAgent,
        requestId,
        afterJson: { code: err.code, message: err.message, meta: err.meta },
      })
    }

    return errorResponse(err, requestId)
  }
}

export async function GET() {
  return jsonResponse({
    service: 'LightRAG-API-Base',
    endpoint: '/api/v1/search',
    method: 'POST',
    auth: 'Authorization: Bearer lra-{32hex}',
    docs: 'POST JSON { kbId, query, topK?, mode?(hybrid|dense|sparse), rerank?, prefetchLimit?, filter?, withParentContext?, debug? }',
    reminder: '嵌入/重排模型必须与向量入库时一致（详见管理后台「设置」）',
  })
}
