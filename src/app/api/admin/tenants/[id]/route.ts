import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse, errorResponse } from '@/lib/http'
import { writeAudit } from '@/lib/audit'
import { toGatewayError } from '@/lib/errors'
import { peek } from '@/lib/rate-limit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UpdateTenant = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  ratePerMin: z.number().int().min(-1).max(100000).optional(),
  dailyQuota: z.number().int().min(-1).max(10000000).optional(),
  contact: z.string().max(256).optional(),
  metaJson: z.record(z.unknown()).optional(),
})

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  // 不走 withAdmin 包装以保留 ctx.params；内联鉴权
  const { withAdminInline } = await import('@/lib/admin-inline')
  return withAdminInline(req, async (admin, httpCtx) => {
    const { id } = await ctx.params
    const tenant = await db.tenant.findUnique({ where: { id }, include: { _count: { select: { apiKeys: true, kbMappings: true } } } })
    if (!tenant) return errorResponse({ code: 'NOT_FOUND', message: '租户不存在' } as any, httpCtx.requestId)
    const usage = peek({
      tenantId: tenant.id,
      ratePerMin: tenant.ratePerMin || 60,
      dailyQuota: tenant.dailyQuota || 10000,
    })
    return jsonResponse({ tenant, rateLimit: usage })
  })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { withAdminInline } = await import('@/lib/admin-inline')
  return withAdminInline(req, async (admin, httpCtx) => {
    if (admin.role !== 'admin') return errorResponse({ code: 'FORBIDDEN', message: '需要管理员权限' } as any, httpCtx.requestId)
    const { id } = await ctx.params
    const before = await db.tenant.findUnique({ where: { id } })
    if (!before) return errorResponse({ code: 'NOT_FOUND', message: '租户不存在' } as any, httpCtx.requestId)
    const body = UpdateTenant.parse(await req.json())
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description
    if (body.enabled !== undefined) data.enabled = body.enabled
    if (body.ratePerMin !== undefined) data.ratePerMin = body.ratePerMin
    if (body.dailyQuota !== undefined) data.dailyQuota = body.dailyQuota
    if (body.contact !== undefined) data.contact = body.contact
    if (body.metaJson !== undefined) data.metaJson = JSON.stringify(body.metaJson)
    const tenant = await db.tenant.update({ where: { id }, data })
    writeAudit({
      tenantId: id,
      actor: `admin:${admin.userId}`,
      action: 'tenant.update',
      targetType: 'tenant',
      targetId: id,
      beforeJson: { name: before.name, enabled: before.enabled, ratePerMin: before.ratePerMin, dailyQuota: before.dailyQuota },
      afterJson: { name: tenant.name, enabled: tenant.enabled, ratePerMin: tenant.ratePerMin, dailyQuota: tenant.dailyQuota },
      ip: httpCtx.clientIp,
      userAgent: httpCtx.userAgent,
      requestId: httpCtx.requestId,
    })
    return jsonResponse({ tenant })
  })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { withAdminInline } = await import('@/lib/admin-inline')
  return withAdminInline(req, async (admin, httpCtx) => {
    if (admin.role !== 'admin') return errorResponse({ code: 'FORBIDDEN', message: '需要管理员权限' } as any, httpCtx.requestId)
    const { id } = await ctx.params
    try {
      await db.tenant.delete({ where: { id } })
      writeAudit({
        actor: `admin:${admin.userId}`,
        action: 'tenant.delete',
        targetType: 'tenant',
        targetId: id,
        ip: httpCtx.clientIp,
        userAgent: httpCtx.userAgent,
        requestId: httpCtx.requestId,
      })
      return jsonResponse({ ok: true })
    } catch (e) {
      return errorResponse(toGatewayError(e), httpCtx.requestId)
    }
  })
}
