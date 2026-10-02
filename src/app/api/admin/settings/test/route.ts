import { NextRequest } from 'next/server'
import { testEmbedding } from '@/lib/embed'
import { testRerank } from '@/lib/rerank'
import { qdrant } from '@/lib/qdrant'
import { loadSettings } from '@/lib/config'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'
import { toGatewayError, GatewayError } from '@/lib/errors'
import { errorResponse } from '@/lib/http'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TestBody = z.object({
  target: z.enum(['qdrant', 'embedding', 'rerank']),
  // 可选覆盖（管理后台"设置"页编辑中测试，未保存即测）
  apiBase: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  url: z.string().optional(),
})

/** 测试连通性 —— 支持用当前 DB 配置或临时覆盖值测试 */
export const POST = withAdmin(async (req, ctx) => {
  const body = TestBody.parse(await req.json())
  const settings = await loadSettings()
  let result: { ok: boolean; message: string; dim?: number; hasSparse?: boolean; version?: string }

  if (body.target === 'qdrant') {
    const url = body.url ?? settings.qdrantUrl
    const apiKey = body.apiKey ?? settings.qdrantApiKey
    if (!url) {
      return jsonResponse({ ok: false, message: 'Qdrant URL 为空' })
    }
    const h = await qdrant.health({ ...settings, qdrantUrl: url, qdrantApiKey: apiKey })
    result = { ok: h.ok, message: h.ok ? `连接成功${h.version ? ' · v' + h.version : ''}` : '连接失败', version: h.version }
  } else if (body.target === 'embedding') {
    const apiBase = body.apiBase ?? settings.embedApiBase
    const apiKey = body.apiKey ?? settings.embedApiKey
    const model = body.model ?? settings.embedModel
    result = await testEmbedding(apiBase, apiKey, model)
  } else if (body.target === 'rerank') {
    const apiBase = body.apiBase ?? settings.rerankApiBase
    const apiKey = body.apiKey ?? settings.rerankApiKey
    const model = body.model ?? settings.rerankModel
    result = await testRerank(apiBase, apiKey, model)
  } else {
    throw new GatewayError('BAD_REQUEST', '未知测试目标')
  }
  return jsonResponse(result)
})
