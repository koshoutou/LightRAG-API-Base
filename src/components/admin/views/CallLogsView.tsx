'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CallLog } from '@/components/admin/api'
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
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CallLogList {
  items: CallLog[]
  total: number
  limit: number
  offset: number
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'ok', label: 'ok' },
  { value: 'error', label: 'error' },
  { value: 'ratelimited', label: 'ratelimited' },
  { value: 'unauthorized', label: 'unauthorized' },
]

const MODE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'hybrid', label: 'hybrid' },
  { value: 'dense', label: 'dense' },
  { value: 'sparse', label: 'sparse' },
]

const LIMIT_OPTIONS = [20, 50, 100]

export function CallLogsView() {
  const [tenantId, setTenantId] = useState('')
  const [status, setStatus] = useState('all')
  const [mode, setMode] = useState('all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(20)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<CallLog | null>(null)

  const params = new URLSearchParams()
  if (tenantId) params.set('tenantId', tenantId)
  if (status !== 'all') params.set('status', status)
  if (mode !== 'all') params.set('mode', mode)
  if (q) params.set('q', q)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['call-logs', tenantId, status, mode, q, limit, offset],
    queryFn: () => api.get<CallLogList>(`/api/admin/call-logs?${params.toString()}`),
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const from = total > 0 ? offset + 1 : 0
  const to = Math.min(offset + items.length, total)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">调用日志</h1>
        <p className="text-sm text-muted-foreground">所有 /api/v1/search 调用记录与各阶段耗时</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Input placeholder="租户 ID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
            <Select value={status} onValueChange={(v) => { setStatus(v); setOffset(0) }}>
              <SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={mode} onValueChange={(v) => { setMode(v); setOffset(0) }}>
              <SelectTrigger><SelectValue placeholder="模式" /></SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
              </SelectContent>
            </Select>
            <Input placeholder="query 关键词" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0) }} />
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
                    <TableHead>状态</TableHead>
                    <TableHead>租户ID</TableHead>
                    <TableHead>模式</TableHead>
                    <TableHead>topK</TableHead>
                    <TableHead>耗时(ms)</TableHead>
                    <TableHead>结果数</TableHead>
                    <TableHead>query</TableHead>
                    <TableHead>collection</TableHead>
                    <TableHead>requestId</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(c)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="font-mono text-xs">{truncateMid(c.tenantId, 12)}</TableCell>
                      <TableCell>{c.mode}</TableCell>
                      <TableCell>{c.topK}</TableCell>
                      <TableCell className="tabular-nums">{c.tookMs}</TableCell>
                      <TableCell className="tabular-nums">{c.resultCount}</TableCell>
                      <TableCell>
                        <div className="max-w-[300px] truncate" title={c.query}>{c.query || '—'}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.collection}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{truncateMid(c.requestId, 12)}</TableCell>
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

      <CallLogDetailDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function CallLogDetailDialog({ log, onClose }: { log: CallLog | null; onClose: () => void }) {
  return (
    <Dialog open={!!log} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        {log && (
          <>
            <DialogHeader>
              <DialogTitle>调用详情</DialogTitle>
              <DialogDescription className="font-mono">
                {new Date(log.createdAt).toLocaleString('zh-CN')} · {log.requestId}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="状态"><StatusBadge status={log.status} /></Field>
                <Field label="模式">{log.mode}</Field>
                <Field label="topK">{log.topK}</Field>
                <Field label="结果数">{log.resultCount}</Field>
                <Field label="融合">{log.fusion}</Field>
                <Field label="RRF K">{log.rrfK}</Field>
                <Field label="prefetch">{log.prefetchLimit}</Field>
                <Field label="rerank">{log.rerank ? '是' : '否'}</Field>
                <Field label="HTTP">{log.httpStatus}</Field>
                <Field label="耗时(ms)">{log.tookMs}</Field>
                <Field label="租户" mono>{log.tenantId}</Field>
                <Field label="collection" mono>{log.collection}</Field>
                <Field label="kbId" mono>{log.kbId}</Field>
                <Field label="clientIp">{log.clientIp || '—'}</Field>
                <Field label="来源">{log.source || '—'}</Field>
                <Field label="API Key" mono>{log.apiKey?.name ?? log.apiKeyId ?? '—'}</Field>
              </div>

              {log.errorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  <span className="font-medium">{log.errorCode ?? 'ERROR'}</span>: {log.errorMessage}
                </div>
              )}

              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">阶段耗时（ms）</div>
                <TimingBars log={log} />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">query</div>
                <div className="rounded-md border bg-muted/30 p-3 text-sm">{log.query || '—'}</div>
              </div>

              {log.userAgent && (
                <Field label="userAgent" mono wrap>{log.userAgent}</Field>
              )}

              <JsonBlock label="resultsJson" value={log.resultsJson} />
              <JsonBlock label="embedFingerprintJson" value={log.embedFingerprintJson} />

              {log.rerankLog && (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    关联 rerank 日志 · model={log.rerankLog.model} · topN={log.rerankLog.topN} · {log.rerankLog.tookMs}ms
                  </div>
                  <JsonBlock label="candidatesJson" value={log.rerankLog.candidatesJson} />
                  <JsonBlock label="resultsJson" value={log.rerankLog.resultsJson} />
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TimingBars({ log }: { log: CallLog }) {
  const stages = [
    { key: 'embed', label: 'embed', value: log.embedMs },
    { key: 'recall', label: 'recall', value: log.recallMs },
    { key: 'fusion', label: 'fusion', value: log.fusionMs },
    { key: 'rerank', label: 'rerank', value: log.rerankMs },
    { key: 'context', label: 'context', value: log.contextMs },
  ]
  const max = Math.max(1, ...stages.map((s) => s.value))
  return (
    <div className="space-y-1.5">
      {stages.map((s) => (
        <div key={s.key} className="flex items-center gap-2 text-xs">
          <div className="w-16 shrink-0 text-muted-foreground">{s.label}</div>
          <div className="relative h-3 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(2, (s.value / max) * 100)}%` }}
            />
          </div>
          <div className="w-16 shrink-0 text-right tabular-nums">{s.value}ms</div>
        </div>
      ))}
    </div>
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
        <pre className="break-all whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs font-mono">
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ElementType }> = {
    ok: { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', icon: CheckCircle2 },
    error: { cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300', icon: XCircle },
    ratelimited: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', icon: AlertTriangle },
    unauthorized: { cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300', icon: XCircle },
  }
  const cfg = map[status] ?? map.ok
  const Icon = cfg.icon
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap gap-1', cfg.cls)}>
      <Icon className="h-3 w-3" />
      {status}
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
