import { loadSettings, PlatformSettings } from './config'
import { qdrant, buildSearchFilter, QdrantHit, VectorFilter } from './qdrant'
import { embedQuery, SparseVector } from './embed'
import { callRerank } from './rerank'
import { GatewayError } from './errors'
import { createHash } from 'node:crypto'

/**
 * 检索编排 —— 复刻 LightRAG-Base runSearch 六阶段管线
 *   A. Embedding（query 向量化，dense + sparse）
 *   B. 双路召回（dense / sparse 并行查 Qdrant，filter must 含 enabled=true）
 *   C. 融合（RRF K=60 / DBSF）
 *   D. Rerank（可选，OpenAI 兼容 /rerank）
 *   E. 上下文回填（只读：仅取 Qdrant payload，不读 artifacts 全文）
 *   F. 日志（调用日志 + 重排序结果日志 + 计量）
 *
 * 重要差异（只读网关）：
 *   - chunk 全文不在 Qdrant（仅 ≤200 字符 preview + 可选 parent_text）
 *   - rerank 输入用 parent_text（若有）或 text_preview，与 LightRAG-Base 用 artifacts 全文略有差异
 *   - 返回 SearchResponse 结构与 LightRAG-Base 对齐，便于上层 Agent 无缝替换
 */

export interface SearchRequest {
  kbId: string
  collection: string
  query: string
  topK?: number
  mode?: 'hybrid' | 'dense' | 'sparse'
  rerank?: boolean
  prefetchLimit?: number
  filter?: {
    docIds?: string[]
    pageRange?: [number, number]
  }
  withParentContext?: boolean
  debug?: {
    fusion?: 'rrf' | 'dbsf'
    rrfK?: number
    rrfWeights?: [number, number]
    prefetchLimit?: number
  }
  // 网关内部
  settings: PlatformSettings
  kbDim: number
  kbEmbeddingModel: string
}

export interface SearchHit {
  chunkId: string
  score: number
  rerankScore?: number | null
  text: string
  parentText?: string | null
  source: {
    docId: string
    page: number
    bbox: number[] | null
    seq: number
    docType: string
  }
}

export interface SearchResponse {
  tookMs: number
  stages: {
    embedMs: number
    recallMs: number
    fusionMs: number
    rerankMs: number
    contextMs: number
  }
  results: SearchHit[]
  debug: {
    embed: {
      dim: number
      denseHash: string
      denseFirst8: number[]
      sparseNnz: number
      provider: string
      model: string
    }
    denseTop: { chunkId: string; score: number; page: number; preview: string }[]
    sparseTop: { chunkId: string; score: number; page: number; preview: string }[]
    fusedTop: { chunkId: string; score: number; denseRank?: number; sparseRank?: number }[]
    rerankTop?: { chunkId: string; rerankScore: number; prevRank: number }[]
    fusion: string
    rrfK?: number
    mode: string
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function hashDense(dense: number[]): string {
  return createHash('sha256').update(dense.map((v) => v.toFixed(6)).join(',')).digest('hex').slice(0, 16)
}

interface RankedHit {
  id: string | number
  score: number
  payload: Record<string, unknown> | null
}

/** RRF 融合：score(id) = Σ w[ranker] / (K + rank_in_ranker + 1) */
export function rrfFuse(
  denseRanked: RankedHit[],
  sparseRanked: RankedHit[],
  opts: { limit: number; k?: number; weights?: [number, number] },
): RankedHit[] {
  const k = opts.k ?? 60
  const [wd, ws] = opts.weights ?? [0.5, 0.5]
  const scores = new Map<string, number>()
  const payloads = new Map<string, Record<string, unknown> | null>()
  denseRanked.forEach((h, i) => {
    const key = String(h.id)
    scores.set(key, (scores.get(key) ?? 0) + wd / (k + i + 1))
    if (!payloads.has(key)) payloads.set(key, h.payload)
  })
  sparseRanked.forEach((h, i) => {
    const key = String(h.id)
    scores.set(key, (scores.get(key) ?? 0) + ws / (k + i + 1))
    if (!payloads.has(key)) payloads.set(key, h.payload)
  })
  return [...scores.entries()]
    .map(([id, score]) => ({
      id: id,
      score,
      payload: payloads.get(id) ?? null,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
}

/** DBSF 融合：各路 z-score 归一后加权和 */
export function dbsfFuse(
  denseRanked: RankedHit[],
  sparseRanked: RankedHit[],
  opts: { limit: number; weights?: [number, number] },
): RankedHit[] {
  const [wd, ws] = opts.weights ?? [0.5, 0.5]
  const zscore = (arr: RankedHit[]): Map<string, number> => {
    const m = arr.map((h) => h.score)
    if (m.length === 0) return new Map()
    const mean = m.reduce((a, b) => a + b, 0) / m.length
    const variance = m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length
    const std = Math.sqrt(variance) || 1
    const z = new Map<string, number>()
    arr.forEach((h) => z.set(String(h.id), (h.score - mean) / std))
    return z
  }
  const dz = zscore(denseRanked)
  const sz = zscore(sparseRanked)
  const scores = new Map<string, number>()
  const payloads = new Map<string, Record<string, unknown> | null>()
  denseRanked.forEach((h) => {
    const key = String(h.id)
    scores.set(key, (scores.get(key) ?? 0) + wd * (dz.get(key) ?? 0))
    if (!payloads.has(key)) payloads.set(key, h.payload)
  })
  sparseRanked.forEach((h) => {
    const key = String(h.id)
    scores.set(key, (scores.get(key) ?? 0) + ws * (sz.get(key) ?? 0))
    if (!payloads.has(key)) payloads.set(key, h.payload)
  })
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, payload: payloads.get(id) ?? null }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
}

/** 主检索入口 */
export async function runSearch(req: SearchRequest): Promise<{
  response: SearchResponse
  // 网关内部数据（用于日志）
  internals: {
    denseRanked: RankedHit[]
    sparseRanked: RankedHit[]
    fused: RankedHit[]
    rerankInput: { chunkId: string; text: string; prevRank: number; prevScore: number }[]
    rerankOutput: { chunkId: string; rerankScore: number; prevRank: number; newRank: number; delta: number }[]
    rerankRaw?: unknown
    rerankModel?: string
    rerankTookMs?: number
    embedProvider: string
    embedModel: string
    embedDim: number
    sparseNnz: number
    denseHash: string
    denseFirst8: number[]
    fusionUsed: string
    rrfKUsed: number
    weightsUsed: [number, number]
  }
}> {
  const s = req.settings
  const t0 = Date.now()

  // 边界裁剪（与 LightRAG-Base 对齐）
  const topK = Math.min(Math.max(req.topK ?? s.defaultTopK, 1), 50)
  const mode = req.mode ?? s.defaultMode
  const wantRerank = req.rerank ?? s.defaultRerank
  const fusion = req.debug?.fusion ?? s.defaultFusion
  const rrfK = req.debug?.rrfK ?? s.defaultRrfK
  const weights: [number, number] = req.debug?.rrfWeights ?? s.defaultRrfWeights
  const prefetchLimit = Math.min(
    Math.max(req.debug?.prefetchLimit ?? req.prefetchLimit ?? s.defaultPrefetchLimit, topK),
    200,
  )

  // ---- Stage A: Embedding ----
  const tEmbed = Date.now()
  const emb = await embedQuery(req.query, { settings: s, expectDim: req.kbDim || undefined })
  const embedMs = Date.now() - tEmbed
  const denseHash = hashDense(emb.dense)
  const denseFirst8 = emb.dense.slice(0, 8).map(round6)
  const sparseNnz = emb.sparse ? emb.sparse.indices.length : 0

  // 一致性提醒：KB 注册的 embeddingModel 与平台配置不一致时记 warn（不阻断）
  if (req.kbEmbeddingModel && req.kbEmbeddingModel !== s.embedModel) {
    console.warn(
      `[search] KB ${req.kbId} 注册嵌入模型 ${req.kbEmbeddingModel} 与平台配置 ${s.embedModel} 不一致，向量空间可能不匹配`,
    )
  }

  // ---- Stage B: 双路召回 ----
  const tRecall = Date.now()
  const vfilter: VectorFilter = buildSearchFilter({
    docIds: req.filter?.docIds,
    pageRange: req.filter?.pageRange,
  })
  const needDense = mode === 'hybrid' || mode === 'dense'
  const needSparse = mode === 'hybrid' || mode === 'sparse'

  let denseRanked: RankedHit[] = []
  let sparseRanked: RankedHit[] = []

  try {
    ;[denseRanked, sparseRanked] = await Promise.all([
      needDense
        ? qdrant
            .queryDense(req.collection, emb.dense, { limit: prefetchLimit, filter: vfilter, settings: s })
            .then((hits) => hits.map((h) => ({ id: h.id, score: h.score, payload: h.payload })))
        : Promise.resolve([]),
      needSparse && emb.sparse
        ? qdrant
            .querySparse(
              req.collection,
              { indices: emb.sparse.indices, values: emb.sparse.values },
              { limit: prefetchLimit, filter: vfilter, settings: s },
            )
            .then((hits) => hits.map((h) => ({ id: h.id, score: h.score, payload: h.payload })))
        : Promise.resolve([]),
    ])
  } catch (e) {
    if (e instanceof GatewayError && e.code === 'NOT_FOUND') {
      throw new GatewayError(
        'UPSTREAM_ERROR',
        `向量集合 ${req.collection} 在 Qdrant 中不存在（可能 KB 未入库或集合名错误）`,
        { meta: { collection: req.collection, kbId: req.kbId } },
      )
    }
    throw e
  }
  const recallMs = Date.now() - tRecall

  // ---- Stage C: 融合 ----
  const tFusion = Date.now()
  let fused: RankedHit[]
  if (mode === 'dense') {
    fused = denseRanked.slice(0, topK * 4)
  } else if (mode === 'sparse') {
    fused = sparseRanked.slice(0, topK * 4)
  } else {
    fused =
      fusion === 'dbsf'
        ? dbsfFuse(denseRanked, sparseRanked, { limit: Math.max(prefetchLimit, topK), weights })
        : rrfFuse(denseRanked, sparseRanked, { limit: Math.max(prefetchLimit, topK), k: rrfK, weights })
  }
  const fusionMs = Date.now() - tFusion

  // ---- Stage D: Rerank（可选）----
  const tRerank = Date.now()
  let rerankOutput: { chunkId: string; rerankScore: number; prevRank: number; newRank: number; delta: number }[] = []
  let rerankInput: { chunkId: string; text: string; prevRank: number; prevScore: number }[] = []
  let rerankRaw: unknown | undefined
  let rerankModel: string | undefined
  let rerankTookMs = 0
  let finalOrder: RankedHit[] = fused.slice(0, topK)

  if (wantRerank && fused.length > 0) {
    const candidates = fused.slice(0, Math.max(prefetchLimit, topK))
    rerankInput = candidates.map((h, i) => {
      const p = h.payload ?? {}
      const text = (req.withParentContext ?? true) && p.parent_text ? String(p.parent_text) : String(p.text_preview ?? '')
      return {
        chunkId: String(h.id),
        text,
        prevRank: i + 1,
        prevScore: round6(h.score),
      }
    })
    const texts = rerankInput.map((c) => c.text)
    const rr = await callRerank(req.query, texts, Math.min(topK, candidates.length), { settings: s })
    rerankRaw = rr.raw
    rerankModel = rr.model
    rerankTookMs = rr.tookMs
    const ranked = rr.results
    rerankOutput = ranked.map((r, i) => {
      const ci = rerankInput[r.index]
      return {
        chunkId: ci?.chunkId ?? '',
        rerankScore: round6(r.score),
        prevRank: ci?.prevRank ?? 0,
        newRank: i + 1,
        delta: (ci?.prevRank ?? 0) - (i + 1),
      }
    })
    // 按重排结果重排 finalOrder
    finalOrder = ranked
      .map((r) => candidates[r.index])
      .filter(Boolean)
      .slice(0, topK)
  }
  const rerankMs = Date.now() - tRerank

  // ---- Stage E: 上下文回填（只读：从 payload 取）----
  const tContext = Date.now()
  const rerankScores = new Map<string, number>()
  for (const r of rerankOutput) rerankScores.set(r.chunkId, r.rerankScore)

  const hits: SearchHit[] = await Promise.all(
    finalOrder.map(async (h) => {
      const p = h.payload ?? {}
      const chunkId = String(h.id)
      return {
        chunkId,
        score: round6(h.score),
        rerankScore: rerankScores.has(chunkId) ? rerankScores.get(chunkId)! : null,
        text: String(p.text_preview ?? ''),
        parentText:
          (req.withParentContext ?? true) && p.parent_text ? String(p.parent_text) : null,
        source: {
          docId: String(p.doc_id ?? ''),
          page: Number(p.page ?? 0),
          bbox: Array.isArray(p.bbox_from) ? (p.bbox_from as number[]) : null,
          seq: Number(p.seq ?? 0),
          docType: String(p.doc_type ?? 'text'),
        },
      }
    }),
  )
  const contextMs = Date.now() - tContext

  const tookMs = Date.now() - t0

  const response: SearchResponse = {
    tookMs,
    stages: { embedMs, recallMs, fusionMs, rerankMs, contextMs },
    results: hits,
    debug: {
      embed: {
        dim: emb.dim,
        denseHash,
        denseFirst8,
        sparseNnz,
        provider: emb.provider,
        model: emb.model,
      },
      denseTop: denseRanked.slice(0, 10).map((h) => ({
        chunkId: String(h.id),
        score: round6(h.score),
        page: Number(h.payload?.page ?? 0),
        preview: String(h.payload?.text_preview ?? '').slice(0, 80),
      })),
      sparseTop: sparseRanked.slice(0, 10).map((h) => ({
        chunkId: String(h.id),
        score: round6(h.score),
        page: Number(h.payload?.page ?? 0),
        preview: String(h.payload?.text_preview ?? '').slice(0, 80),
      })),
      fusedTop: fused.slice(0, 50).map((h, i) => {
        const key = String(h.id)
        const denseRank = denseRanked.findIndex((d) => String(d.id) === key)
        const sparseRank = sparseRanked.findIndex((d) => String(d.id) === key)
        return {
          chunkId: key,
          score: round6(h.score),
          denseRank: denseRank >= 0 ? denseRank + 1 : undefined,
          sparseRank: sparseRank >= 0 ? sparseRank + 1 : undefined,
        }
      }),
      rerankTop: rerankOutput.length
        ? rerankOutput.map((r) => ({ chunkId: r.chunkId, rerankScore: r.rerankScore, prevRank: r.prevRank }))
        : undefined,
      fusion: mode === 'hybrid' ? fusion : mode,
      rrfK: mode === 'hybrid' && fusion === 'rrf' ? rrfK : undefined,
      mode,
    },
  }

  return {
    response,
    internals: {
      denseRanked,
      sparseRanked,
      fused,
      rerankInput,
      rerankOutput,
      rerankRaw,
      rerankModel,
      rerankTookMs,
      embedProvider: emb.provider,
      embedModel: emb.model,
      embedDim: emb.dim,
      sparseNnz,
      denseHash,
      denseFirst8,
      fusionUsed: mode === 'hybrid' ? fusion : mode,
      rrfKUsed: rrfK,
      weightsUsed: weights,
    },
  }
}
