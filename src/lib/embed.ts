import { loadSettings, PlatformSettings, hasEmbeddingConfigured } from './config'
import { GatewayError } from './errors'

/**
 * Embedding 客户端 —— OpenAI 兼容 /v1/embeddings
 * 复刻 LightRAG-Base callEmbed 行为：
 *   POST {embedApiBase}/embeddings
 *   body: { model, input: string | string[] }
 *   resp: { data: [{ index, embedding: number[], sparse_indices?: {indices, values} }] }
 *
 * 重要：embedApiBase/embedApiKey/embedModel 必须与向量入库时完全一致，
 * 否则向量空间不匹配，召回结果无意义。入库侧以 LightRAG-Base 知识库设置为准。
 */

export interface EmbedResult {
  vectors: number[][] // dense
  sparse: SparseVector[] // sparse（若 API 返回则用，否则为空数组）
  dim: number
  provider: string
  model: string
}

export interface SparseVector {
  indices: number[]
  values: number[]
}

const BATCH = 64

export async function embedTexts(
  texts: string[],
  opts?: { settings?: PlatformSettings; onProgress?: (done: number, total: number) => void },
): Promise<EmbedResult> {
  const settings = opts?.settings ?? (await loadSettings())
  if (!(await hasEmbeddingConfigured(settings))) {
    throw new GatewayError('SETTING_MISSING', 'Embedding 模型未配置：请先在管理后台「设置」中填写嵌入 API', {
      meta: {
        hint: '必须与向量入库时使用的嵌入服务/模型完全一致',
        embedApiBase: settings.embedApiBase || '(空)',
        embedModel: settings.embedModel || '(空)',
      },
    })
  }
  const base = settings.embedApiBase.replace(/\/+$/, '')
  const allVectors: number[][] = []
  const allSparse: SparseVector[] = []
  let dim = 0
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const res = await fetch(base + '/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.embedApiKey ? { Authorization: `Bearer ${settings.embedApiKey}` } : {}),
      },
      body: JSON.stringify({ model: settings.embedModel, input: batch.length === 1 ? batch[0] : batch }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      let msg = txt
      try {
        msg = JSON.parse(txt)?.error?.message || txt
      } catch {
        /* keep raw */
      }
      throw new GatewayError('EMBED_FAILED', `Embedding API 错误 (${res.status}): ${String(msg).slice(0, 300)}`, {
        meta: { httpStatus: res.status, model: settings.embedModel },
      })
    }
    const json: any = await res.json()
    const data: any[] = json.data || []
    const sorted = data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const d of sorted) {
      const vec: number[] = d.embedding ?? []
      if (vec.length === 0) {
        throw new GatewayError('EMBED_FAILED', 'Embedding API 返回空向量', { meta: { model: settings.embedModel } })
      }
      if (dim === 0) dim = vec.length
      allVectors.push(vec)
      // 提取 sparse：兼容 sparse_indices / sparse 两种字段
      const sp = d.sparse_indices ?? d.sparse
      if (sp && Array.isArray(sp.indices) && Array.isArray(sp.values)) {
        allSparse.push({ indices: sp.indices, values: sp.values })
      } else {
        allSparse.push({ indices: [], values: [] })
      }
    }
    opts?.onProgress?.(Math.min(i + BATCH, texts.length), texts.length)
  }
  if (dim === 0) dim = settings.embedDim || 1024
  return {
    vectors: allVectors,
    sparse: allSparse,
    dim,
    provider: `openai-compatible · ${settings.embedModel}`,
    model: settings.embedModel,
  }
}

/** 单条嵌入 —— 检索查询向量化 */
export async function embedQuery(
  query: string,
  opts?: { settings?: PlatformSettings; expectDim?: number },
): Promise<{ dense: number[]; sparse: SparseVector | null; dim: number; provider: string; model: string }> {
  const r = await embedTexts([query], opts)
  const sparse = r.sparse[0]
  return {
    dense: r.vectors[0],
    sparse: sparse && sparse.indices.length > 0 ? sparse : null,
    dim: r.dim,
    provider: r.provider,
    model: r.model,
  }
}

/** 嵌入连通性测试（管理后台「设置」页用） */
export async function testEmbedding(
  apiBase: string,
  apiKey: string,
  model: string,
): Promise<{ ok: boolean; dim?: number; hasSparse?: boolean; message: string }> {
  if (!apiBase) return { ok: false, message: 'API Base 为空' }
  if (!model) return { ok: false, message: '模型 ID 为空' }
  try {
    const base = apiBase.replace(/\/+$/, '')
    const res = await fetch(base + '/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: 'ping' }),
      cache: 'no-store',
    })
    const text = await res.text()
    let json: any
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      return { ok: false, message: `非 JSON 响应：${text.slice(0, 200)}` }
    }
    if (!res.ok) {
      const msg = json?.error?.message || json?.error || json?.message || `HTTP ${res.status}`
      return { ok: false, message: `Embedding 测试失败：${msg}` }
    }
    const data = json?.data || []
    const dim = data[0]?.embedding?.length
    const hasSparse = Boolean(data[0]?.sparse_indices || data[0]?.sparse)
    return { ok: true, dim, hasSparse, message: `连接成功 · ${dim}d${hasSparse ? ' · 含 sparse' : ''}` }
  } catch (e: any) {
    return { ok: false, message: `Embedding 测试失败：${e?.message ?? String(e)}` }
  }
}
