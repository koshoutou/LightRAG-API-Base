import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createAdminSession, ADMIN_SESSION_COOKIE } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { toGatewayError, GatewayError } from '@/lib/errors'
import { getClientIp, getRequestId, jsonResponse, errorResponse } from '@/lib/http'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const clientIp = getClientIp(req)
  const userAgent = req.headers.get('user-agent') ?? ''
  try {
    const body = LoginBody.parse(await req.json())
    const user = await db.adminUser.findUnique({ where: { username: body.username } })
    if (!user || !user.enabled) {
      throw new GatewayError('UNAUTHORIZED', '用户名或密码错误')
    }
    if (!verifyPassword(body.password, user.passwordHash)) {
      writeAudit({
        actor: `admin:${body.username}`,
        action: 'admin.login_failed',
        targetType: 'admin',
        targetId: user.id,
        ip: clientIp,
        userAgent,
        requestId,
      })
      throw new GatewayError('UNAUTHORIZED', '用户名或密码错误')
    }
    const session = await createAdminSession(user.id, { ip: clientIp, userAgent, issuedBy: 'password' })
    await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    writeAudit({
      actor: `admin:${user.id}`,
      action: 'admin.login',
      targetType: 'admin',
      targetId: user.id,
      ip: clientIp,
      userAgent,
      requestId,
    })
    const res = jsonResponse({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
      expiresAt: session.expiresAt,
    })
    res.cookies.set(ADMIN_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session.expiresAt,
    })
    return res
  } catch (e) {
    return errorResponse(toGatewayError(e), requestId)
  }
}
