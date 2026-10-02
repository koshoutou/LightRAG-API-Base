import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 重排序结果日志列表 */
export const GET = withAdmin(async (req, ctx) => {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') ?? ''
  const model = url.searchParams.get('model') ?? ''
  const search = url.searchParams.get('search') ?? ''
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)
  const where: any = {}
  if (tenantId) where.tenantId = tenantId
  if (model) where.model = model
  if (search) where.query = { contains: search }
  const [items, total] = await Promise.all([
    db.rerankLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { callLog: { select: { kbId: true, collection: true, mode: true, topK: true, status: true, clientIp: true, requestId: true } } },
    }),
    db.rerankLog.count({ where }),
  ])
  return jsonResponse({ items, total, limit, offset })
})
