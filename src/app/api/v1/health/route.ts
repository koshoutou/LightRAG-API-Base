import { NextResponse } from 'next/server'
import { loadSettings, hasQdrantConfigured, hasEmbeddingConfigured, hasRerankConfigured } from '@/lib/config'
import { qdrant } from '@/lib/qdrant'
import { render } from '@/lib/prometheus'
import { jsonResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const settings = await loadSettings()
  const qdrantHealth = await qdrant.health(settings)
  const body = {
    status: 'ok',
    service: 'LightRAG-API-Base',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    checks: {
      qdrant: {
        configured: await hasQdrantConfigured(settings),
        reachable: qdrantHealth.ok,
        version: qdrantHealth.version,
      },
      embedding: {
        configured: await hasEmbeddingConfigured(settings),
        model: settings.embedModel || null,
        dim: settings.embedDim || null,
      },
      rerank: {
        configured: await hasRerankConfigured(settings),
        model: settings.rerankModel || null,
      },
      circuitBreaker: settings.readonlyCircuitBreaker ? 'OPEN' : 'CLOSED',
    },
    defaults: {
      topK: settings.defaultTopK,
      mode: settings.defaultMode,
      rerank: settings.defaultRerank,
      prefetchLimit: settings.defaultPrefetchLimit,
      fusion: settings.defaultFusion,
      rrfK: settings.defaultRrfK,
    },
    reminder:
      '嵌入/重排模型必须与向量入库时一致；详见管理后台「设置」页一致性提醒',
  }
  return jsonResponse(body)
}
