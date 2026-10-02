import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'
import { writeAudit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CreateTenant = z.object({
  name: z.string().min(1).max(128),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().max(512).optional(),
  ratePerMin: z.number().int().min(-1).max(100000).optional(),
  dailyQuota: z.number().int().min(-1).max(10000000).optional(),
  contact: z.string().max(256).optional(),
  metaJson: z.record(z.unknown()).optional(),
})

export const GET = withAdmin(async (req, ctx) => {
  const url = new URL(req.url)
  const search = url.searchParams.get('search') ?? ''
  const enabled = url.searchParams.get('enabled')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)
  const where: any = {}
  if (search) where.OR = [{ name: { contains: search } }, { slug: { contains: search } }]
  if (enabled === 'true') where.enabled = true
  if (enabled === 'false') where.enabled = false
  const [items, total] = await Promise.all([
    db.tenant.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
    db.tenant.count({ where }),
  ])
  return jsonResponse({ items, total, limit, offset })
})

export const POST = withAdmin(async (req, ctx) => {
  const body = CreateTenant.parse(await req.json())
  const tenant = await db.tenant.create({
    data: {
      name: body.name,
      slug: body.slug,
      description: body.description ?? '',
      ratePerMin: body.ratePerMin ?? 0,
      dailyQuota: body.dailyQuota ?? 0,
      contact: body.contact ?? '',
      metaJson: JSON.stringify(body.metaJson ?? {}),
    },
  })
  writeAudit({
    tenantId: tenant.id,
    actor: `admin:${ctx.admin.userId}`,
    action: 'tenant.create',
    targetType: 'tenant',
    targetId: tenant.id,
    afterJson: { name: tenant.name, slug: tenant.slug },
    ip: ctx.clientIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  })
  return jsonResponse({ tenant }, { status: 201 })
}, { role: 'admin' })
