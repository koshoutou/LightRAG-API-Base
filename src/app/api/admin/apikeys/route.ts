import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'
import { writeAudit } from '@/lib/audit'
import { generateApiKey } from '@/lib/crypto'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CreateKey = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1).max(128),
  role: z.enum(['readonly', 'operator', 'admin']).optional(),
  ratePerMinOverride: z.number().int().min(-1).max(100000).optional(),
  dailyQuotaOverride: z.number().int().min(-1).max(10000000).optional(),
  expiresAt: z.string().optional(),
})

export const GET = withAdmin(async (req, ctx) => {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') ?? ''
  const enabled = url.searchParams.get('enabled')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)
  const where: any = {}
  if (tenantId) where.tenantId = tenantId
  if (enabled === 'true') where.enabled = true
  if (enabled === 'false') where.enabled = false
  const [items, total] = await Promise.all([
    db.apiKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        tenantId: true,
        name: true,
        keyPrefix: true,
        keyFormat: true,
        role: true,
        enabled: true,
        ratePerMinOverride: true,
        dailyQuotaOverride: true,
        expiresAt: true,
        lastUsedAt: true,
        callCount: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
    db.apiKey.count({ where }),
  ])
  return jsonResponse({ items, total, limit, offset })
})

export const POST = withAdmin(async (req, ctx) => {
  const body = CreateKey.parse(await req.json())
  // 校验租户存在
  const tenant = await db.tenant.findUnique({ where: { id: body.tenantId } })
  if (!tenant) return jsonResponse({ error: '租户不存在' }, { status: 404 })
  const { raw, hash, prefix, format } = generateApiKey('lra')
  const apiKey = await db.apiKey.create({
    data: {
      tenantId: body.tenantId,
      name: body.name,
      keyHash: hash,
      keyPrefix: prefix,
      keyFormat: format,
      role: body.role ?? 'readonly',
      ratePerMinOverride: body.ratePerMinOverride ?? 0,
      dailyQuotaOverride: body.dailyQuotaOverride ?? 0,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      keyPrefix: true,
      role: true,
      enabled: true,
      ratePerMinOverride: true,
      dailyQuotaOverride: true,
      expiresAt: true,
      createdAt: true,
    },
  })
  writeAudit({
    tenantId: body.tenantId,
    actor: `admin:${ctx.admin.userId}`,
    action: 'apikey.create',
    targetType: 'apikey',
    targetId: apiKey.id,
    afterJson: { name: apiKey.name, role: apiKey.role, keyPrefix: apiKey.keyPrefix },
    ip: ctx.clientIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  })
  // ⚠ raw key 仅此一次返回，后续不再可见
  return jsonResponse({ apiKey, key: raw, reminder: '请立即保存，密钥明文仅此一次返回' }, { status: 201 })
}, { role: 'admin' })
