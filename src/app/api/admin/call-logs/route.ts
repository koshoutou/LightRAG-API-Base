import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 调用日志列表（支持过滤/分页） */
export const GET = withAdmin(async (req, ctx) => {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') ?? ''
  const kbId = url.searchParams.get('kbId') ?? ''
  const status = url.searchParams.get('status') ?? ''
  const mode = url.searchParams.get('mode') ?? ''
  const source = url.searchParams.get('source') ?? ''
  const apiKeyId = url.searchParams.get('apiKeyId') ?? ''
  const search = url.searchParams.get('search') ?? ''
  const startDate = url.searchParams.get('startDate')
  const endDate = url.searchParams.get('endDate')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)
  const where: any = {}
  if (tenantId) where.tenantId = tenantId
  if (kbId) where.kbId = kbId
  if (status) where.status = status
  if (mode) where.mode = mode
  if (source) where.source = source
  if (apiKeyId) where.apiKeyId = apiKeyId
  if (search) where.query = { contains: search }
  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = new Date(startDate)
    if (endDate) where.createdAt.lte = new Date(endDate)
  }
  const [items, total] = await Promise.all([
    db.callLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { rerankLog: true },
    }),
    db.callLog.count({ where }),
  ])
  return jsonResponse({ items, total, limit, offset })
})
