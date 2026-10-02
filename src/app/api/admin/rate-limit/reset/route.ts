import { NextRequest } from 'next/server'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'
import { reset } from '@/lib/rate-limit'
import { writeAudit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ResetBody = z.object({
  tenantId: z.string().min(1),
  apiKeyId: z.string().optional(),
})

/** 重置某租户（+ API Key）的限流计数（运维止血用） */
export const POST = withAdmin(async (req, ctx) => {
  const body = ResetBody.parse(await req.json())
  reset(body.tenantId, body.apiKeyId)
  writeAudit({
    tenantId: body.tenantId,
    actor: `admin:${ctx.admin.userId}`,
    action: 'ratelimit.reset',
    targetType: 'tenant',
    targetId: body.tenantId,
    afterJson: { apiKeyId: body.apiKeyId ?? null },
    ip: ctx.clientIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  })
  return jsonResponse({ ok: true })
}, { role: 'admin' })
