import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAdminInline } from '@/lib/admin-inline'
import { jsonResponse, errorResponse } from '@/lib/http'
import { toGatewayError } from '@/lib/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Ctx { params: Promise<{ id: string }> }

/** 单条调用日志详情（含 rerankLog） */
export async function GET(req: NextRequest, ctx: Ctx) {
  return withAdminInline(req, async (admin, httpCtx) => {
    const { id } = await ctx.params
    const log = await db.callLog.findUnique({
      where: { id },
      include: { rerankLog: true, apiKey: { select: { name: true, keyPrefix: true } }, tenant: { select: { name: true, slug: true } } },
    })
    if (!log) return errorResponse(toGatewayError(new Error('调用日志不存在')), httpCtx.requestId)
    return jsonResponse({ log })
  })
}
