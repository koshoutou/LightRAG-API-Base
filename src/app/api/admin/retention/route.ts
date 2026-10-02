import { NextRequest } from 'next/server'
import { withAdmin } from '@/lib/admin-middleware'
import { jsonResponse } from '@/lib/http'
import { runRetention } from '@/lib/retention'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 手动触发日志保留清理 */
export const POST = withAdmin(async (req, ctx) => {
  const stats = await runRetention()
  writeAudit({
    actor: `admin:${ctx.admin.userId}`,
    action: 'retention.run',
    targetType: 'system',
    afterJson: stats,
    ip: ctx.clientIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  })
  return jsonResponse({ ok: true, deleted: stats })
}, { role: 'admin' })
