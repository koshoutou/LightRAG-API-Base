import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

/** SHA-256 hex 摘要（用于 API Key 哈希存储、会话 token 哈希） */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}

/** 生成 API Key 明文：lra-{32 hex}，返回 {raw, hash, prefix} */
export function generateApiKey(format = 'lra'): {
  raw: string
  hash: string
  prefix: string
  format: string
} {
  const hex = randomBytes(16).toString('hex') // 32 hex chars
  const raw = `${format}-${hex}`
  const hash = sha256Hex(raw)
  const prefix = `${format}-${hex.slice(0, 4)}****`
  return { raw, hash, prefix, format }
}

/** 常量时间比较两个 hex 字符串，防侧信道 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** 生成管理后台会话 token（URL-safe base64, 32 bytes） */
export function generateSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: sha256Hex(raw) }
}

/** 生成随机密码盐 + argon2id 兼容占位（实际哈希在 password.ts 实现） */
export function randomToken(len = 32): string {
  return randomBytes(len).toString('base64url')
}

export { randomUUID }
