import { NextRequest } from 'next/server'
import { authenticateApiKey, parseBearerAuth } from '@/lib/auth'
import { loadSettings } from '@/lib/config'
import { qdrant } from '@/lib/qdrant'
import { toGatewayError } from '@/lib/errors'
import { getClientIp, getRequestId, jsonResponse, errorResponse, corsPreflightResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function OPTIONS() {
  return corsPreflightResponse()
}

/** 列出 Qdrant 集合（operator+ 可用，用于管理后台发现可注册的 KB） */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req)
  try {
    const settings = await loadSettings()
    const token = parseBearerAuth(req.headers.get('authorization'))
    if (!token) {
      const e: any = new Error('缺少 Authorization: Bearer <ApiKey>')
      e.code = 'UNAUTHORIZED'
      return errorResponse(toGatewayError(e), requestId)
    }
    const auth = await authenticateApiKey(token, {
      ratePerMin: settings.defaultRatePerMin,
      dailyQuota: settings.defaultDailyQuota,
    })
    // 仅 operator+ 可列举集合（防止 readonly 探测）
    if (auth.role === 'readonly') {
      const e: any = new Error('需要 operator 及以上权限')
      e.code = 'FORBIDDEN'
      return errorResponse(toGatewayError(e), requestId)
    }
    const collections = await qdrant.listCollections(settings)
    // 带详细信息（vectors config / points_count）
    const detailed = await Promise.all(
      collections.slice(0, 100).map(async (c) => {
        try {
          const info = await qdrant.collectionInfo(c.name, settings)
          const vectors = info?.config?.params?.vectors
          const dense = vectors && typeof vectors === 'object' && !Array.isArray(vectors)
            ? ('dense' in vectors ? { name: 'dense', size: vectors.dense?.size, distance: vectors.dense?.distance } : { name: null, size: vectors.size, distance: vectors.distance })
            : null
          const sparse = Object.keys(info?.config?.params?.sparse_vectors ?? {})
          return {
            name: c.name,
            status: c.status,
            pointsCount: info?.points_count ?? 0,
            indexedVectorsCount: info?.indexed_vectors_count ?? 0,
            dense: dense ? `${dense.size}d ${dense.distance}` : null,
            sparse: sparse.length ? sparse.join(',') : null,
          }
        } catch {
          return { name: c.name, status: c.status, pointsCount: null, dense: null, sparse: null }
        }
      }),
    )
    return jsonResponse({ collections: detailed, count: collections.length })
  } catch (e) {
    return errorResponse(toGatewayError(e), requestId)
  }
}
