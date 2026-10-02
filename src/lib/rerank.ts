import { loadSettings, PlatformSettings, hasRerankConfigured } from './config'
import { GatewayError } from './errors'

/**
 * Rerank 客户端 —— OpenAI 兼容 /v1/rerank
 * 复刻 LightRAG-Base callRerank：
 *   POST {rerankApiBase}/rerank
 *   body: { model, query, documents: string[], top_n }
 *   resp: { results: [{ index, relevance_score | score, document? }] }
 *
 * 重要：必须与入库/检索侧使用的重排模型一致，否则重排序结果不可对比
 */

export interface RerankResult {
  index: number
  score: number
  document: string
}

export async function callRerank(
  query: string,
  documents: string[],
  topN: number,
  opts?: { settings?: PlatformSettings; timeoutMs?: number },
): Promise<{ results: RerankResult[]; model: string; tookMs: number; raw: unknown }> {
  const settings = opts?.settings ?? (await loadSettings())
  if (!(await hasRerankConfigured(settings))) {
    throw new GatewayError('SETTING_MISSING', 'Rerank 模型未配置：请先在管理后台「设置」中填写重排 API', {
      meta: {
        hint: '必须与入库/检索侧使用的重排模型一致',
        rerankApiBase: settings.rerankApiBase || '(空)',
        rerankModel: settings.rerankModel || '(空)',
      },
    })
  }
  const base = settings.rerankApiBase.replace(/\/+$/, '')
  const start = Date.now()
  const controller = new AbortController()
  const timeout = opts?.timeoutMs ?? 15_000
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(base + '/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.rerankApiKey ? { Authorization: `Bearer ${settings.rerankApiKey}` } : {}),
      },
      body: JSON.stringify({ model: settings.rerankModel, query, documents, top_n: topN }),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new GatewayError('RERANK_FAILED', `Rerank API 错误 (${res.status}): ${txt.slice(0, 300)}`, {
        meta: { httpStatus: res.status, model: settings.rerankModel },
      })
    }
    const json: any = await res.json()
    const results: RerankResult[] = (json.results || []).map((r: any) => ({
      index: r.index ?? 0,
      score: r.relevance_score ?? r.score ?? 0,
      document: r.document?.text || r.document || documents[r.index ?? 0] || '',
    }))
    const tookMs = Date.now() - start
    return { results, model: settings.rerankModel, tookMs, raw: json }
  } catch (e) {
    if (e instanceof GatewayError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('abort') || msg.includes('timeout')) {
      throw new GatewayError('RERANK_FAILED', `Rerank 请求超时（${timeout}ms）`, { meta: { model: settings.rerankModel } })
    }
    throw new GatewayError('RERANK_FAILED', `Rerank 不可达：${msg}`, { meta: { model: settings.rerankModel } })
  } finally {
    clearTimeout(timer)
  }
}

/** Rerank 连通性测试（管理后台「设置」页用） */
export async function testRerank(
  apiBase: string,
  apiKey: string,
  model: string,
): Promise<{ ok: boolean; message: string }> {
  if (!apiBase) return { ok: false, message: 'API Base 为空' }
  if (!model) return { ok: false, message: '模型 ID 为空' }
  try {
    const base = apiBase.replace(/\/+$/, '')
    const res = await fetch(base + '/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, query: 'ping', documents: ['hello', 'world'], top_n: 2 }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, message: `Rerank 测试失败：HTTP ${res.status} ${text.slice(0, 200)}` }
    }
    const json: any = await res.json().catch(() => ({}))
    const n = json?.results?.length ?? 0
    return { ok: true, message: `Rerank API 可用 · 返回 ${n} 条` }
  } catch (e: any) {
    return { ok: false, message: `Rerank 测试失败：${e?.message ?? String(e)}` }
  }
}
