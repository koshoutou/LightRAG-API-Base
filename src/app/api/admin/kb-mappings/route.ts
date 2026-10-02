import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'
import { writeAudit } from '@/lib/audit'
import { qdrant } from '@/lib/qdrant'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CreateMapping = z.object({
  tenantId: z.string().min(1),
  kbId: z.string().min(1),
  collection: z.string().min(1).max(128),
  name: z.string().max(256).optional(),
  dim: z.number().int().min(0).max(8192).optional(),
  embeddingModel: z.string().max(128).optional(),
  enabled: z.boolean().optional(),
})

export const GET = withAdmin(async (req, ctx) => {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') ?? ''
  const kbId = url.searchParams.get('kbId') ?? ''
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)
  const where: any = {}
  if (tenantId) where.tenantId = tenantId
  if (kbId) where.kbId = kbId
  const [items, total] = await Promise.all([
    db.kbMapping.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { tenant: { select: { name: true, slug: true } } } }),
    db.kbMapping.count({ where }),
  ])
  return jsonResponse({ items, total, limit, offset })
})

export const POST = withAdmin(async (req, ctx) => {
  const body = CreateMapping.parse(await req.json())
  const tenant = await db.tenant.findUnique({ where: { id: body.tenantId } })
  if (!tenant) return jsonResponse({ error: '租户不存在' }, { status: 404 })
  const mapping = await db.kbMapping.create({
    data: {
      tenantId: body.tenantId,
      kbId: body.kbId,
      collection: body.collection,
      name: body.name ?? '',
      dim: body.dim ?? 0,
      embeddingModel: body.embeddingModel ?? '',
      enabled: body.enabled ?? true,
    },
  })
  writeAudit({
    tenantId: body.tenantId,
    actor: `admin:${ctx.admin.userId}`,
    action: 'kbmap.create',
    targetType: 'kbmap',
    targetId: mapping.id,
    afterJson: { kbId: mapping.kbId, collection: mapping.collection, dim: mapping.dim, embeddingModel: mapping.embeddingModel },
    ip: ctx.clientIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  })
  return jsonResponse({ mapping }, { status: 201 })
}, { role: 'admin' })
