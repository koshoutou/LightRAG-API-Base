# LightRAG-API-Base · 企业级 Qdrant 检索审计网关

> 一套常驻运行的"只读 + 控制面"检索网关：所有上层（Agent、Hermes、个人工具）只调它来检索 Qdrant。
> 统一承担 **鉴权 · 路由 · 检索 · Rerank · 限流 · 审计 · 调用日志 · 重排序结果日志 · 多租户计量**，不直接碰向量库。

## 设计定位

| 维度 | 说明 |
|---|---|
| **职责边界** | 只做"读"与"控"。读 = Qdrant 检索代理；控 = 鉴权/路由/限流/审计/计量。**不写库**（无 PUT /collections、无 PUT /points、无 DELETE） |
| **与 LightRAG-Base 关系** | LightRAG-Base 负责文档入库（解析→切分→嵌入→写 Qdrant）；本网关负责检索侧的统一入口与审计。两者共享同一套 Qdrant 集合与嵌入/重排模型 |
| **向量格式兼容** | 复刻 LightRAG-Base 的 Qdrant 请求格式（命名向量 `dense` / `sparse`、payload 字段、`filter.must` 含 `enabled=true`、RRF K=60 权重 [0.5,0.5]） |
| **部署形态** | Next.js 16 生产服务，常驻运行；控制面数据（租户/API Key/日志/计量）存 SQLite，向量数据始终在 Qdrant |

## 功能总览

- **多租户隔离**：租户 → API Key → KB 映射三级授权；支持跨租户 KB 共享开关
- **Bearer 鉴权**：`lra-{32hex}` API Key，三角色 `readonly / operator / admin`；明文仅创建时返回一次（库存 SHA-256 哈希）
- **限流**：内存滑动窗口（每分钟）+ 日配额；API Key 可覆盖租户配额；`-1` = 无限
- **检索编排**：复刻 LightRAG-Base 六阶段 `embed → 双路召回(dense/sparse) → 融合(RRF/DBSF) → rerank → context → log`
- **Rerank**：OpenAI 兼容 `/v1/rerank`；重排输入/输出/原始响应全量落 `RerankLog`
- **审计**：管理操作 + 关键安全事件（登录失败/限流/未授权/熔断）落 `AuditLog`
- **调用日志**：每次 `/api/v1/search` 一条 `CallLog`，含六阶段耗时、结果摘要、嵌入指纹、客户端信息、requestId
- **多租户计量**：按租户 × 日聚合（检索数/错误数/限流数/重排数/embedTokens/rerankDocuments/延迟 p50/p95 近似/max）
- **Prometheus 指标**：`/api/v1/metrics` 暴露 `lra_requests_total`、`lra_search_latency_ms` 等
- **管理后台**：响应式 Web 控制台（仪表盘/设置/租户/API Key/KB 映射/调用日志/重排日志/审计日志/计量）
- **熔断止血**：只读熔断开关，开启后所有检索直接 503

## 技术栈

Next.js 16（App Router）· TypeScript 5 · Tailwind CSS 4 · shadcn/ui · Prisma（SQLite）· TanStack Query · Zod · Recharts

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 配置环境变量（首次）
cp .env.example .env
#   填写：DATABASE_URL / JWT_SECRET / ADMIN_BOOTSTRAP_TOKEN
#         QDRANT_URL / EMBED_API_BASE / EMBED_MODEL / RERANK_API_BASE / RERANK_MODEL
#   ⚠ Qdrant 与嵌入/重排模型必须与 LightRAG-Base 入库侧完全一致

# 3. 初始化控制面数据库
bun run db:push

# 4. 启动（默认端口 3001，可在 .env 改 PORT）
bun run dev
```

打开 `http://localhost:3001`：
- 首次访问进入引导页，用 `ADMIN_BOOTSTRAP_TOKEN` 创建管理员
- 登录后进入「平台设置」配置 Qdrant / Embedding / Rerank（每项都有连通性测试按钮）
- 在「租户管理」创建租户 → 「API Key」签发密钥 → 「知识库映射」注册 `kbId ↔ collection`

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | SQLite 路径，默认 `file:./db/audit.db` |
| `JWT_SECRET` | 是 | 管理后台会话签名密钥（随机长字符串） |
| `ADMIN_BOOTSTRAP_TOKEN` | 否 | 首次创建管理员的引导令牌 |
| `QDRANT_URL` | 是 | Qdrant 服务地址（只读检索目标） |
| `QDRANT_API_KEY` | 否 | Qdrant API Key（若启用鉴权） |
| `EMBED_API_BASE` | 是 | OpenAI 兼容嵌入 API Base（`/v1/embeddings`） |
| `EMBED_API_KEY` | 否 | 嵌入 API Key |
| `EMBED_MODEL` | 是 | 嵌入模型 ID（**必须与入库一致**） |
| `RERANK_API_BASE` | 否 | OpenAI 兼容重排 API Base（`/v1/rerank`） |
| `RERANK_API_KEY` | 否 | 重排 API Key |
| `RERANK_MODEL` | 否 | 重排模型 ID（**必须与检索侧一致**） |

> 环境变量为**引导兜底**；运行时以管理后台「平台设置」的 DB 配置为准（可热改无需重启）。

## 嵌入/重排模型一致性（关键）

⚠ **嵌入模型必须与向量入库时完全一致**（同 API Base + 同 Model + 同维度），否则向量空间不匹配，召回结果无意义。入库侧以 **LightRAG-Base 知识库设置** 中的 `embedApiBase / embedModel` 为准。

⚠ **重排模型必须与入库/检索侧一致**，否则重排序结果不可对比。

管理后台「平台设置」页与 KB 映射页均有一致性提醒；检索时若 KB 注册的 `embeddingModel` 与平台配置不一致会在日志告警。

## 检索 API 契约

### `POST /api/v1/search`

```http
POST /api/v1/search
Authorization: Bearer lra-{32hex}
Content-Type: application/json

{
  "kbId": "<LightRAG-Base KB ID>",
  "query": "检索文本",
  "topK": 5,                       // 可选，默认 5，clamp [1,50]
  "mode": "hybrid",                // 可选 hybrid | dense | sparse，默认 hybrid
  "rerank": false,                 // 可选，是否重排
  "prefetchLimit": 50,             // 可选，默认 50，clamp [topK,200]
  "filter": {                      // 可选
    "docIds": ["..."],
    "pageRange": [1, 10]
  },
  "withParentContext": true,       // 可选，是否携带 parent_text
  "debug": {                       // 可选，仅 operator+/admin
    "fusion": "rrf",               // rrf | dbsf
    "rrfK": 60,
    "rrfWeights": [0.5, 0.5],
    "prefetchLimit": 50
  }
}
```

响应（`SearchResponse`，与 LightRAG-Base 对齐）：

```jsonc
{
  "tookMs": 120,
  "stages": { "embedMs": 30, "recallMs": 40, "fusionMs": 1, "rerankMs": 0, "contextMs": 2 },
  "results": [
    {
      "chunkId": "<uuidv5>",
      "score": 0.016393,
      "rerankScore": null,
      "text": "<≤200 字符预览>",
      "parentText": "<可选父 chunk 全文>",
      "source": { "docId": "...", "page": 1, "bbox": [x0,y0,x1,y1], "seq": 0, "docType": "text" }
    }
  ],
  "debug": {
    "embed": { "dim": 1024, "denseHash": "...", "sparseNnz": 0, "provider": "openai-compatible · BAAI/bge-m3", "model": "BAAI/bge-m3" },
    "denseTop": [...], "sparseTop": [...], "fusedTop": [...],
    "rerankTop": [...],
    "fusion": "rrf", "rrfK": 60, "mode": "hybrid"
  }
}
```

错误响应统一为 `{ "error": "<CODE>", "message": "...", "detail": {...} }`，HTTP 状态码见下表：

| CODE | HTTP | 含义 |
|---|---|---|
| UNAUTHORIZED | 401 | 缺/错 API Key |
| FORBIDDEN | 403 | 角色不足 / 租户停用 |
| APIKEY_DISABLED | 403 | Key 已禁用 |
| APIKEY_EXPIRED | 403 | Key 已过期 |
| RATE_LIMITED | 429 | 超每分钟限流 |
| QUOTA_EXCEEDED | 429 | 超日配额 |
| CIRCUIT_OPEN | 503 | 熔断开启 |
| BAD_REQUEST | 400 | 参数校验失败 |
| KB_NOT_REGISTERED | 404 | KB 未注册到租户 |
| KB_DISABLED | 403 | KB 已停用 |
| SETTING_MISSING | 503 | Qdrant/Embedding 未配置 |
| EMBED_FAILED | 502 | 嵌入 API 调用失败 |
| RERANK_FAILED | 502 | 重排 API 调用失败 |
| QDRANT_UNREACHABLE | 502 | Qdrant 不可达 |
| UPSTREAM_ERROR | 502 | 上游错误 |

### 其他对外端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/v1/health` | 无 | 健康检查（配置状态 + Qdrant 可达性 + 一致性提醒） |
| GET | `/api/v1/metrics` | 无 | Prometheus 指标 |
| GET | `/api/v1/collections` | Bearer(operator+) | 列出 Qdrant 集合（供 KB 映射注册参考） |
| OPTIONS | `/api/v1/*` | 无 | CORS 预检 |

## 管理后台 API

所有 `/api/admin/*` 端点需管理后台会话 Cookie（登录后下发，12h 有效）：

- `POST /api/admin/bootstrap` — 首次引导创建管理员
- `POST /api/admin/auth/login` / `POST /api/admin/auth/logout` / `GET /api/admin/auth/me`
- `GET|PUT /api/admin/settings` — 平台设置
- `POST /api/admin/settings/test` — Qdrant/Embedding/Rerank 连通性测试
- `GET|POST /api/admin/tenants` · `GET|PUT|DELETE /api/admin/tenants/[id]`
- `GET|POST /api/admin/apikeys` · `GET|PATCH|DELETE /api/admin/apikeys/[id]`
- `GET|POST /api/admin/kb-mappings` · `PUT|DELETE /api/admin/kb-mappings/[id]`
- `GET /api/admin/call-logs` · `GET /api/admin/call-logs/[id]`
- `GET /api/admin/rerank-logs`
- `GET /api/admin/audit-logs`
- `GET /api/admin/usage?days=N` — 多租户计量统计
- `POST /api/admin/retention` — 手动触发日志保留清理
- `POST /api/admin/rate-limit/reset` — 重置租户限流计数

## 与 LightRAG-Base 的兼容性

本网关复刻 LightRAG-Base `runSearch` 的请求格式与编排逻辑：

- **Qdrant 请求**：`POST /collections/{name}/points/query`，`using: 'dense'` / `using: 'sparse'`，`filter.must` 恒含 `{key:'enabled', match:{value:true}}`，`with_payload: true`
- **向量格式**：命名向量 `{dense: number[], sparse: {indices, values}}`；payload 14 字段（`kb_id/doc_id/parent_id/page/page_from/page_to/bbox_from/bbox_to/seq/token_count/text_preview/doc_type/enabled/created_at/parent_text?`）
- **融合**：RRF `score(id)=Σ w/(K+rank+1)`，K=60，weights=[0.5,0.5]；可选 DBSF
- **点 ID**：上游为 uuidv5 字符串，本网关透传不做校验

**只读差异**：网关不持有 LightRAG-Base 的 `artifacts/{kbId}/{docId}/chunks/{chunkId}.txt` 全文，因此：
- `text` 字段返回 Qdrant payload 中的 `text_preview`（≤200 字符）
- `parentText` 返回 payload 中的 `parent_text`（若有）
- rerank 输入用 `parent_text` 或 `text_preview`，与 LightRAG-Base 用全文略有差异（如需完全一致，可与 LightRAG-Base 同机部署并扩展读取 artifacts）

## 安全提示

- `.env` 已被 `.gitignore` 排除，**切勿提交真实密钥**
- API Key 明文仅创建时返回一次，库存 SHA-256 哈希
- 管理后台密码使用 PBKDF2-SHA256（100k 迭代 + 16B 盐）
- 会话 Cookie `httpOnly` + `sameSite=lax`，生产环境 `secure`
- 建议生产部署：反代启用 HTTPS / 限制管理后台访问来源 / 定期轮换 JWT_SECRET 与管理员密码

## License

MIT
