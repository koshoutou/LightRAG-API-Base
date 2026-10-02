import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { toGatewayError, GatewayError } from '@/lib/errors'
import { getClientIp, getRequestId, jsonResponse, errorResponse } from '@/lib/http'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BootstrapBody = z.object({
  bootstrapToken: z.string().optional(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128),
})

/**
 * 首次部署引导 —— 仅当无管理员时可用
 * 用 ADMIN_BOOTSTRAP_TOKEN（.env）授权首次创建
 * 之后通过 /api/admin/auth/login 登录
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const clientIp = getClientIp(req)
  try {
    const existing = await db.adminUser.count()
    if (existing > 0) {
      throw new GatewayError('BAD_REQUEST', '管理员已存在，引导已关闭。请使用 /api/admin/auth/login 登录。')
    }
    const body = BootstrapBody.parse(await req.json())
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN
    if (expected && body.bootstrapToken !== expected) {
      throw new GatewayError('FORBIDDEN', '引导令牌不正确（请检查 ADMIN_BOOTSTRAP_TOKEN 环境变量）')
    }
    const user = await db.adminUser.create({
      data: {
        username: body.username,
        passwordHash: hashPassword(body.password),
        role: 'admin',
      },
      select: { id: true, username: true, role: true },
    })
    writeAudit({
      actor: 'bootstrap',
      action: 'admin.create',
      targetType: 'admin',
      targetId: user.id,
      ip: clientIp,
      requestId,
      afterJson: { username: user.username, role: user.role },
    })
    return jsonResponse({
      ok: true,
      message: '管理员创建成功。请使用 /api/admin/auth/login 登录。',
      user,
    })
  } catch (e) {
    return errorResponse(toGatewayError(e), requestId)
  }
}

export async function GET() {
  const count = await db.adminUser.count()
  return jsonResponse({ bootstrapped: count > 0, adminCount: count })
}
