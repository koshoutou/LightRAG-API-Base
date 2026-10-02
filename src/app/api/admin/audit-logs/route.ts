import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 审计日志列表 */
export const GET = withAdmin(async (req, ctx) => {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') ?? ''
  const actor = url.searchParams.get('actor') ?? ''
  const action = url.searchParams.get('action') ?? ''
  const targetType = url.searchParams.get('targetType') ?? ''
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)
  const where: any = {}
  if (tenantId) where.tenantId = tenantId
  if (actor) where.actor = { contains: actor }
  if (action) where.action = { contains: action }
  if (targetType) where.targetType = targetType
  const [items, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
    db.auditLog.count({ where }),
  ])
  return jsonResponse({ items, total, limit, offset })
})
