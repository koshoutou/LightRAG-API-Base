'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type AuditLog } from '@/components/admin/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AuditLogList {
  items: AuditLog[]
  total: number
  limit: number
  offset: number
}

const TARGET_TYPE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'tenant', label: 'tenant' },
  { value: 'apikey', label: 'apikey' },
  { value: 'setting', label: 'setting' },
  { value: 'kbmap', label: 'kbmap' },
  { value: 'calllog', label: 'calllog' },
  { value: 'admin', label: 'admin' },
  { value: 'system', label: 'system' },
]

const LIMIT_OPTIONS = [20, 50, 100]

export function AuditLogsView() {
  const [tenantId, setTenantId] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('all')
  const [limit, setLimit] = useState(20)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<AuditLog | null>(null)

  const params = new URLSearchParams()
  if (tenantId) params.set('tenantId', tenantId)
  if (actor) params.set('actor', actor)
  if (action) params.set('action', action)
  if (targetType !== 'all') params.set('targetType', targetType)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit-logs', tenantId, actor, action, targetType, limit, offset],
    queryFn: () => api.get<AuditLogList>(`/api/admin/audit-logs?${params.toString()}`),
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const from = total > 0 ? offset + 1 : 0
  const to = Math.min(offset + items.length, total)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">审计日志</h1>
        <p className="text-sm text-muted-foreground">控制面所有写操作的前后状态记录</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Input placeholder="租户 ID" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setOffset(0) }} />
            <Input placeholder="actor（操作者）" value={actor} onChange={(e) => { setActor(e.target.value); setOffset(0) }} />
            <Input placeholder="action（如 apikey.create）" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0) }} />
            <Select value={targetType} onValueChange={(v) => { setTargetType(v); setOffset(0) }}>
              <SelectTrigger><SelectValue placeholder="targetType" /></SelectTrigger>
              <SelectContent>
                {TARGET_TYPE_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setOffset(0) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((n) => (<SelectItem key={n} value={String(n)}>{n} 条/页</SelectItem>))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="shrink-0">
              {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              刷新
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>actor</TableHead>
                    <TableHead>action</TableHead>
                    <TableHead>targetType</TableHead>
                    <TableHead>targetId</TableHead>
                    <TableHead>tenantId</TableHead>
                    <TableHead>ip</TableHead>
                    <TableHead>requestId</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((a) => (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(a)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell className="text-xs">{a.actor || '—'}</TableCell>
                      <TableCell><ActionBadge action={a.action} /></TableCell>
                      <TableCell><TargetTypeBadge type={a.targetType} /></TableCell>
                      <TableCell className="font-mono text-xs">{truncateMid(a.targetId, 12)}</TableCell>
                      <TableCell className="font-mono text-xs">{truncateMid(a.tenantId, 12)}</TableCell>
                      <TableCell className="text-xs">{a.ip || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{truncateMid(a.requestId, 12)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">共 {total} 条 · 第 {from}-{to} 条</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            <ChevronLeft className="h-4 w-4" /> 上一页
          </Button>
          <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            下一页 <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AuditLogDetailDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function AuditLogDetailDialog({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  return (
    <Dialog open={!!log} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        {log && (
          <>
            <DialogHeader>
              <DialogTitle>审计详情</DialogTitle>
              <DialogDescription className="font-mono">
                {new Date(log.createdAt).toLocaleString('zh-CN')} · {log.id}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="actor">{log.actor || '—'}</Field>
                <Field label="action">{log.action}</Field>
                <Field label="targetType">{log.targetType}</Field>
                <Field label="targetId" mono wrap>{log.targetId ?? '—'}</Field>
                <Field label="tenantId" mono wrap>{log.tenantId ?? '—'}</Field>
                <Field label="ip">{log.ip || '—'}</Field>
                <Field label="requestId" mono wrap>{log.requestId}</Field>
                <Field label="createdAt" wrap>{new Date(log.createdAt).toLocaleString('zh-CN')}</Field>
              </div>

              {log.userAgent && (
                <Field label="userAgent" mono wrap>{log.userAgent}</Field>
              )}

              <JsonBlock label="beforeJson（操作前状态）" value={log.beforeJson} />
              <JsonBlock label="afterJson（操作后状态）" value={log.afterJson} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function JsonBlock({ label, value }: { label: string; value: string | null | undefined }) {
  let pretty = value ?? ''
  if (pretty) {
    try {
      pretty = JSON.stringify(JSON.parse(pretty), null, 2)
    } catch {
      // keep raw
    }
  }
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      <ScrollArea className="max-h-72">
        <pre className={cn('break-all whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs font-mono')}>
          {pretty || '—'}
        </pre>
      </ScrollArea>
    </div>
  )
}

function Field({
  label,
  children,
  mono,
  wrap,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
  wrap?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn('truncate text-xs', mono && 'font-mono', wrap && 'whitespace-normal break-all')}
        title={typeof children === 'string' ? children : undefined}
      >
        {children}
      </div>
    </div>
  )
}

const ACTION_TONE: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  delete: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  revoke: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  enable: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  disable: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
}

function ActionBadge({ action }: { action: string }) {
  const verb = action.split('.').pop() ?? action
  const cls = ACTION_TONE[verb] ?? 'bg-muted text-muted-foreground'
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', cls)}>
      {action}
    </Badge>
  )
}

const TARGET_TYPE_TONE: Record<string, string> = {
  tenant: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  apikey: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  setting: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
  kbmap: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  calllog: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
  admin: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  system: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
}

function TargetTypeBadge({ type }: { type: string }) {
  const cls = TARGET_TYPE_TONE[type] ?? 'bg-muted text-muted-foreground'
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', cls)}>
      {type}
    </Badge>
  )
}

function truncateMid(s: string | null | undefined, n: number) {
  if (!s) return '—'
  if (s.length <= n) return s
  const head = Math.ceil(n / 2) - 1
  const tail = n - head - 1
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
