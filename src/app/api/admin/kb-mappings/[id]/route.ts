import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdminInline } from '@/lib/admin-inline'
import { jsonResponse, errorResponse } from '@/lib/http'
import { writeAudit } from '@/lib/audit'
import { toGatewayError } from '@/lib/errors'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UpdateMapping = z.object({
  collection: z.string().max(128).optional(),
  name: z.string().max(256).optional(),
  dim: z.number().int().min(0).max(8192).optional(),
  embeddingModel: z.string().max(128).optional(),
  enabled: z.boolean().optional(),
})

interface Ctx { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, ctx: Ctx) {
  return withAdminInline(req, async (admin, httpCtx) => {
    if (admin.role !== 'admin') return errorResponse(toGatewayError(new Error('需要管理员权限')), httpCtx.requestId)
    const { id } = await ctx.params
    const before = await db.kbMapping.findUnique({ where: { id } })
    if (!before) return errorResponse(toGatewayError(new Error('映射不存在')), httpCtx.requestId)
    const body = UpdateMapping.parse(await req.json())
    const data: any = {}
    if (body.collection !== undefined) data.collection = body.collection
    if (body.name !== undefined) data.name = body.name
    if (body.dim !== undefined) data.dim = body.dim
    if (body.embeddingModel !== undefined) data.embeddingModel = body.embeddingModel
    if (body.enabled !== undefined) data.enabled = body.enabled
    const mapping = await db.kbMapping.update({ where: { id }, data })
    writeAudit({
      tenantId: mapping.tenantId,
      actor: `admin:${admin.userId}`,
      action: 'kbmap.update',
      targetType: 'kbmap',
      targetId: id,
      beforeJson: { collection: before.collection, dim: before.dim, embeddingModel: before.embeddingModel, enabled: before.enabled },
      afterJson: { collection: mapping.collection, dim: mapping.dim, embeddingModel: mapping.embeddingModel, enabled: mapping.enabled },
      ip: httpCtx.clientIp,
      userAgent: httpCtx.userAgent,
      requestId: httpCtx.requestId,
    })
    return jsonResponse({ mapping })
  })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withAdminInline(req, async (admin, httpCtx) => {
    if (admin.role !== 'admin') return errorResponse(toGatewayError(new Error('需要管理员权限')), httpCtx.requestId)
    const { id } = await ctx.params
    const mapping = await db.kbMapping.findUnique({ where: { id }, select: { tenantId: true, kbId: true, collection: true } })
    if (!mapping) return errorResponse(toGatewayError(new Error('映射不存在')), httpCtx.requestId)
    await db.kbMapping.delete({ where: { id } })
    writeAudit({
      tenantId: mapping.tenantId,
      actor: `admin:${admin.userId}`,
      action: 'kbmap.delete',
      targetType: 'kbmap',
      targetId: id,
      beforeJson: { kbId: mapping.kbId, collection: mapping.collection },
      ip: httpCtx.clientIp,
      userAgent: httpCtx.userAgent,
      requestId: httpCtx.requestId,
    })
    return jsonResponse({ ok: true })
  })
}
