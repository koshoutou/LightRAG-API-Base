import { db } from './db'
import { loadSettings } from './config'

/**
 * 日志保留清理 —— 按平台设置的天数删除过期日志
 * 管理后台可手动触发，或由进程内定时器周期调用
 */

export interface RetentionStats {
  callLogs: number
  rerankLogs: number
  auditLogs: number
  sessions: number
}

export async function runRetention(): Promise<RetentionStats> {
  const s = await loadSettings()
  const now = new Date()
  const stats: RetentionStats = { callLogs: 0, rerankLogs: 0, auditLogs: 0, sessions: 0 }

  // CallLog（级联删 RerankLog）
  const callCutoff = new Date(now.getTime() - s.callLogRetentionDays * 24 * 3600 * 1000)
  const callDeleted = await db.callLog.deleteMany({ where: { createdAt: { lt: callCutoff } } })
  stats.callLogs = callDeleted.count

  // RerankLog（按 createdAt 独立清理，兜底孤儿记录）
  const rerankCutoff = new Date(now.getTime() - s.rerankLogRetentionDays * 24 * 3600 * 1000)
  const rerankDeleted = await db.rerankLog.deleteMany({ where: { createdAt: { lt: rerankCutoff } } })
  stats.rerankLogs = rerankDeleted.count

  // AuditLog
  const auditCutoff = new Date(now.getTime() - s.auditLogRetentionDays * 24 * 3600 * 1000)
  const auditDeleted = await db.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } })
  stats.auditLogs = auditDeleted.count

  // 过期会话
  const sessDeleted = await db.adminSession.deleteMany({ where: { expiresAt: { lt: now } } })
  stats.sessions = sessDeleted.count

  return stats
}

/** 进程内周期调度（每小时执行一次） */
let timer: NodeJS.Timeout | null = null
export function startRetentionScheduler(): void {
  if (timer) return
  timer = setInterval(
    () => {
      runRetention().catch(() => {})
    },
    60 * 60 * 1000,
  )
  if (timer.unref) timer.unref()
}
