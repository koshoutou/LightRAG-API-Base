import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdminInline } from '@/lib/admin-inline'
import { jsonResponse, errorResponse } from '@/lib/http'
import { writeAudit } from '@/lib/audit'
import { toGatewayError } from '@/lib/errors'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UpdateKey = z.object({
  name: z.string().max(128).optional(),
  enabled: z.boolean().optional(),
  role: z.enum(['readonly', 'operator', 'admin']).optional(),
  ratePerMinOverride: z.number().int().min(-1).max(100000).optional(),
  dailyQuotaOverride: z.number().int().min(-1).max(10000000).optional(),
  expiresAt: z.string().nullable().optional(),
  revoke: z.boolean().optional(),
})

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return withAdminInline(req, async (admin, httpCtx) => {
    const { id } = await ctx.params
    const apiKey = await db.apiKey.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
    if (!apiKey) return errorResponse(toGatewayError(new Error('API Key 不存在')), httpCtx.requestId)
    // 不返回 keyHash
    const { keyHash: _omit, ...safe } = apiKey as any
    return jsonResponse({ apiKey: safe })
  })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withAdminInline(req, async (admin, httpCtx) => {
    if (admin.role !== 'admin') return errorResponse(toGatewayError(new Error('需要管理员权限')), httpCtx.requestId)
    const { id } = await ctx.params
    const before = await db.apiKey.findUnique({ where: { id } })
    if (!before) return errorResponse(toGatewayError(new Error('API Key 不存在')), httpCtx.requestId)
    const body = UpdateKey.parse(await req.json())
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.enabled !== undefined) data.enabled = body.enabled
    if (body.role !== undefined) data.role = body.role
    if (body.ratePerMinOverride !== undefined) data.ratePerMinOverride = body.ratePerMinOverride
    if (body.dailyQuotaOverride !== undefined) data.dailyQuotaOverride = body.dailyQuotaOverride
    if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
    if (body.revoke) {
      data.enabled = false
      data.revokedAt = new Date()
    }
    const apiKey = await db.apiKey.update({ where: { id }, data })
    writeAudit({
      tenantId: apiKey.tenantId,
      actor: `admin:${admin.userId}`,
      action: body.revoke ? 'apikey.revoke' : 'apikey.update',
      targetType: 'apikey',
      targetId: id,
      beforeJson: { name: before.name, enabled: before.enabled, role: before.role },
      afterJson: { name: apiKey.name, enabled: apiKey.enabled, role: apiKey.role, revokedAt: apiKey.revokedAt },
      ip: httpCtx.clientIp,
      userAgent: httpCtx.userAgent,
      requestId: httpCtx.requestId,
    })
    return jsonResponse({ apiKey })
  })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withAdminInline(req, async (admin, httpCtx) => {
    if (admin.role !== 'admin') return errorResponse(toGatewayError(new Error('需要管理员权限')), httpCtx.requestId)
    const { id } = await ctx.params
    const apiKey = await db.apiKey.findUnique({ where: { id }, select: { tenantId: true, name: true } })
    if (!apiKey) return errorResponse(toGatewayError(new Error('API Key 不存在')), httpCtx.requestId)
    await db.apiKey.delete({ where: { id } })
    writeAudit({
      tenantId: apiKey.tenantId,
      actor: `admin:${admin.userId}`,
      action: 'apikey.delete',
      targetType: 'apikey',
      targetId: id,
      beforeJson: { name: apiKey.name },
      ip: httpCtx.clientIp,
      userAgent: httpCtx.userAgent,
      requestId: httpCtx.requestId,
    })
    return jsonResponse({ ok: true })
  })
}
