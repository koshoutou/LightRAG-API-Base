import { loadSettings, PlatformSettings } from './config'
import { GatewayError } from './errors'

/**
 * Qdrant 只读客户端 —— 严格只读，不提供任何写接口
 * 复刻 LightRAG-Base 的 QdrantVectorStore 读路径请求格式：
 *   - POST /collections/{name}/points/query （dense/sparse 单路）
 *   - POST /collections/{name}/points/scroll
 *   - POST /collections/{name}/points/get
 *   - POST /collections/{name}/points/count
 *   - GET /collections/{name}, /collections, /readyz, /
 * 不提供：PUT /collections, PUT /points, DELETE, setPayload —— 在类型层禁止
 *
 * 重要：filter.must 至少含 {key:'enabled', match:{value:true}}，与上游一致
 */

export interface QdrantHit {
  id: string | number
  score: number
  payload: Record<string, unknown> | null
  vector?: unknown
}

export interface VectorFilterCondition {
  key: string
  match?: { value: unknown; any?: unknown[] }
  range?: { gte?: number; lte?: number; gt?: number; lt?: number }
}

export interface VectorFilter {
  must?: VectorFilterCondition[]
  should?: VectorFilterCondition[]
  must_not?: VectorFilterCondition[]
}

/** 复刻 LightRAG-Base buildSearchFilter —— 恒过滤 enabled=true + 可选 doc_id/page */
export function buildSearchFilter(input: {
  docIds?: string[]
  pageRange?: [number, number]
  extra?: VectorFilterCondition[]
}): VectorFilter {
  const must: VectorFilterCondition[] = [{ key: 'enabled', match: { value: true } }]
  if (input.docIds && input.docIds.length) {
    must.push({ key: 'doc_id', match: { any: input.docIds } })
  }
  if (input.pageRange) {
    must.push({ key: 'page_from', range: { lte: input.pageRange[1] } })
    must.push({ key: 'page_to', range: { gte: input.pageRange[0] } })
  }
  if (input.extra?.length) must.push(...input.extra)
  return { must }
}

class QdrantReadOnly {
  private async fetchJson<T>(
    path: string,
    opts?: { method?: string; body?: unknown; query?: Record<string, string>; timeoutMs?: number; settings?: PlatformSettings },
  ): Promise<T> {
    const settings = opts?.settings ?? (await loadSettings())
    if (!settings.qdrantUrl) {
      throw new GatewayError('SETTING_MISSING', 'Qdrant 未配置：请先在管理后台「设置」中填写 Qdrant 服务地址', {
        meta: { hint: 'admin > 设置 > Qdrant 连接' },
      })
    }
    const base = settings.qdrantUrl.replace(/\/+$/, '')
    let url = base + path
    if (opts?.query && Object.keys(opts.query).length) {
      const qs = new URLSearchParams(opts.query).toString()
      url += (url.includes('?') ? '&' : '?') + qs
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (settings.qdrantApiKey) headers['api-key'] = settings.qdrantApiKey
    const controller = new AbortController()
    const timeout = opts?.timeoutMs ?? 30_000
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, {
        method: opts?.method ?? 'GET',
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      })
      const text = await res.text()
      let json: any
      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        if (!res.ok) {
          throw new GatewayError('QDRANT_UNREACHABLE', `Qdrant 返回非 JSON：HTTP ${res.status} ${text.slice(0, 200)}`, {
            meta: { path, httpStatus: res.status },
          })
        }
        throw new GatewayError('QDRANT_UNREACHABLE', `Qdrant 返回非 JSON：${text.slice(0, 200)}`, {
          meta: { path },
        })
      }
      if (!res.ok) {
        const msg = json?.error || json?.message || `HTTP ${res.status}`
        const code = res.status >= 500 ? 'QDRANT_UNREACHABLE' : res.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_ERROR'
        throw new GatewayError(code, `Qdrant 错误：${msg}`, { meta: { path, httpStatus: res.status } })
      }
      // Qdrant REST envelope: { result, time, status }
      if (json && typeof json === 'object' && 'result' in json) {
        return json.result as T
      }
      return json as T
    } catch (e) {
      if (e instanceof GatewayError) throw e
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('abort') || msg.includes('timeout')) {
        throw new GatewayError('QDRANT_UNREACHABLE', `Qdrant 请求超时（${timeout}ms）`, { meta: { path } })
      }
      throw new GatewayError('QDRANT_UNREACHABLE', `Qdrant 不可达：${msg}`, { meta: { path } })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 健康探测 GET /readyz */
  async health(s?: PlatformSettings): Promise<{ ok: boolean; version?: string; title?: string }> {
    const settings = s ?? (await loadSettings())
    if (!settings.qdrantUrl) return { ok: false }
    const base = settings.qdrantUrl.replace(/\/+$/, '')
    try {
      const res = await fetch(base + '/readyz', {
        headers: settings.qdrantApiKey ? { 'api-key': settings.qdrantApiKey } : {},
        cache: 'no-store',
      })
      if (!res.ok) return { ok: false }
      let version: string | undefined
      try {
        const r2 = await fetch(base + '/', {
          headers: settings.qdrantApiKey ? { 'api-key': settings.qdrantApiKey } : {},
          cache: 'no-store',
        })
        if (r2.ok) version = (await r2.json())?.version
      } catch {
        /* ignore */
      }
      return { ok: true, version }
    } catch (e) {
      return { ok: false }
    }
  }

  /** 列出所有集合 GET /collections */
  async listCollections(s?: PlatformSettings): Promise<{ name: string; status?: string }[]> {
    const r = await this.fetchJson<{ collections: { name: string; status?: string }[] } | any[]>(
      '/collections',
      { settings: s, timeoutMs: 10_000 },
    )
    // 兼容两种返回形态
    if (Array.isArray(r)) return r.map((c) => ({ name: c.name, status: c.status }))
    return (r.collections ?? []).map((c: any) => ({ name: c.name, status: c.status }))
  }

  /** 集合信息 GET /collections/{name} */
  async collectionInfo(name: string, s?: PlatformSettings): Promise<any> {
    return this.fetchJson<any>(`/collections/${encodeURIComponent(name)}`, {
      settings: s,
      timeoutMs: 10_000,
    })
  }

  /** Dense 单路检索：POST /collections/{name}/points/query using='dense' */
  async queryDense(
    collection: string,
    dense: number[],
    opts: { limit: number; filter?: VectorFilter; settings?: PlatformSettings },
  ): Promise<QdrantHit[]> {
    const body = {
      query: dense,
      using: 'dense',
      limit: opts.limit,
      filter: opts.filter,
      with_payload: true,
      with_vector: false,
    }
    const r = await this.fetchJson<{ points?: QdrantHit[] } | QdrantHit[]>(
      `/collections/${encodeURIComponent(collection)}/points/query`,
      { method: 'POST', body, settings: opts.settings },
    )
    return Array.isArray(r) ? r : r.points ?? []
  }

  /** Sparse 单路检索：POST /collections/{name}/points/query using='sparse' */
  async querySparse(
    collection: string,
    sparse: { indices: number[]; values: number[] },
    opts: { limit: number; filter?: VectorFilter; settings?: PlatformSettings },
  ): Promise<QdrantHit[]> {
    const body = {
      query: { indices: sparse.indices, values: sparse.values },
      using: 'sparse',
      limit: opts.limit,
      filter: opts.filter,
      with_payload: true,
      with_vector: false,
    }
    const r = await this.fetchJson<{ points?: QdrantHit[] } | QdrantHit[]>(
      `/collections/${encodeURIComponent(collection)}/points/query`,
      { method: 'POST', body, settings: opts.settings },
    )
    return Array.isArray(r) ? r : r.points ?? []
  }

  /** 按 ID 取点 POST /collections/{name}/points/get */
  async getPoints(
    collection: string,
    ids: (string | number)[],
    opts?: { withPayload?: boolean; withVector?: boolean; settings?: PlatformSettings },
  ): Promise<QdrantHit[]> {
    const body = {
      ids,
      with_payload: opts?.withPayload ?? true,
      with_vector: opts?.withVector ?? false,
    }
    const r = await this.fetchJson<{ points?: QdrantHit[] } | QdrantHit[]>(
      `/collections/${encodeURIComponent(collection)}/points/get`,
      { method: 'POST', body, settings: opts?.settings },
    )
    return Array.isArray(r) ? r : r.points ?? []
  }

  /** 计数 POST /collections/{name}/points/count */
  async count(collection: string, opts?: { filter?: VectorFilter; settings?: PlatformSettings }): Promise<number> {
    const body = { filter: opts?.filter, exact: true }
    const r = await this.fetchJson<{ count: number }>(
      `/collections/${encodeURIComponent(collection)}/points/count`,
      { method: 'POST', body, settings: opts?.settings },
    )
    return r.count ?? 0
  }

  /** scroll POST /collections/{name}/points/scroll —— 用于审计导出/校验 */
  async scroll(
    collection: string,
    opts?: { limit?: number; offset?: string | number; filter?: VectorFilter; settings?: PlatformSettings },
  ): Promise<{ points: QdrantHit[]; next_page_offset?: string | number }> {
    const body = {
      limit: opts?.limit ?? 50,
      offset: opts?.offset,
      filter: opts?.filter,
      with_payload: true,
      with_vector: false,
    }
    const r = await this.fetchJson<{ points: QdrantHit[]; next_page_offset?: string | number }>(
      `/collections/${encodeURIComponent(collection)}/points/scroll`,
      { method: 'POST', body, settings: opts?.settings },
    )
    return r
  }
}

export const qdrant = new QdrantReadOnly()
