import { db } from './db'

/**
 * 审计日志写入器 —— 管理操作 + 关键安全事件
 * fire-and-forget，失败不阻断主流程
 */

export interface AuditEntry {
  tenantId?: string | null
  actor: string
  action: string
  targetType: string
  targetId?: string | null
  beforeJson?: Record<string, unknown>
  afterJson?: Record<string, unknown>
  ip?: string
  userAgent?: string
  requestId?: string
}

export function writeAudit(entry: AuditEntry): void {
  void db.auditLog
    .create({
      data: {
        tenantId: entry.tenantId ?? null,
        actor: entry.actor,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        beforeJson: JSON.stringify(entry.beforeJson ?? {}),
        afterJson: JSON.stringify(entry.afterJson ?? {}),
        ip: entry.ip ?? '',
        userAgent: entry.userAgent ?? '',
        requestId: entry.requestId ?? '',
      },
    })
    .catch(() => {})
}
