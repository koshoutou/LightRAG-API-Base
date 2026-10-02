'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type RerankLog } from '@/components/admin/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

interface RerankLogList {
  items: RerankLog[]
  total: number
  limit: number
  offset: number
}

const LIMIT_OPTIONS = [20, 50, 100]

export function RerankLogsView() {
  const [tenantId, setTenantId] = useState('')
  const [model, setModel] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(20)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<RerankLog | null>(null)

  const params = new URLSearchParams()
  if (tenantId) params.set('tenantId', tenantId)
  if (model) params.set('model', model)
  if (q) params.set('q', q)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['rerank-logs', tenantId, model, q, limit, offset],
    queryFn: () => api.get<RerankLogList>(`/api/admin/rerank-logs?${params.toString()}`),
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const from = total > 0 ? offset + 1 : 0
  const to = Math.min(offset + items.length, total)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">重排日志</h1>
        <p className="text-sm text-muted-foreground">所有 rerank 调用记录、输入候选与排序变化</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input placeholder="租户 ID" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setOffset(0) }} />
            <Input placeholder="model" value={model} onChange={(e) => { setModel(e.target.value); setOffset(0) }} />
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
                    <TableHead>租户</TableHead>
                    <TableHead>query</TableHead>
                    <TableHead>model</TableHead>
                    <TableHead>topN</TableHead>
                    <TableHead>耗时(ms)</TableHead>
                    <TableHead>provider</TableHead>
                    <TableHead>collection</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{truncateMid(r.tenantId, 12)}</TableCell>
                      <TableCell>
                        <div className="max-w-[260px] truncate" title={r.query}>{r.query || '—'}</div>
                      </TableCell>
                      <TableCell className="text-xs">{r.model || '—'}</TableCell>
                      <TableCell>{r.topN}</TableCell>
                      <TableCell className="tabular-nums">{r.tookMs}</TableCell>
                      <TableCell className="text-xs">{r.provider || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.callLog?.collection ?? '—'}</TableCell>
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

      <RerankLogDetailDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function RerankLogDetailDialog({ log, onClose }: { log: RerankLog | null; onClose: () => void }) {
  return (
    <Dialog open={!!log} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        {log && (
          <>
            <DialogHeader>
              <DialogTitle>重排详情</DialogTitle>
              <DialogDescription className="font-mono">
                {new Date(log.createdAt).toLocaleString('zh-CN')} · {log.id}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="租户" mono>{log.tenantId}</Field>
                <Field label="model">{log.model || '—'}</Field>
                <Field label="topN">{log.topN}</Field>
                <Field label="耗时(ms)">{log.tookMs}</Field>
                <Field label="provider">{log.provider || '—'}</Field>
                <Field label="provider raw" wrap mono>{log.providerRawJson ? '已记录' : '—'}</Field>
                <Field label="callLogId" mono>{truncateMid(log.callLogId, 16)}</Field>
                <Field label="关联请求" mono>{log.callLog?.requestId ? truncateMid(log.callLog.requestId, 16) : '—'}</Field>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">query</div>
                <div className="rounded-md border bg-muted/30 p-3 text-sm">{log.query || '—'}</div>
              </div>

              {log.callLog && (
                <div className="rounded-md border p-3 text-xs">
                  <div className="mb-2 font-medium text-muted-foreground">关联调用日志</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label="kbId" mono>{log.callLog.kbId}</Field>
                    <Field label="collection" mono>{log.callLog.collection}</Field>
                    <Field label="mode">{log.callLog.mode}</Field>
                    <Field label="topK">{log.callLog.topK}</Field>
                    <Field label="status">{log.callLog.status}</Field>
                    <Field label="clientIp">{log.callLog.clientIp}</Field>
                    <Field label="requestId" mono wrap>{log.callLog.requestId}</Field>
                  </div>
                </div>
              )}

              <JsonBlock label="candidatesJson（输入候选）" value={log.candidatesJson} />
              <JsonBlock label="resultsJson（排序结果）" value={log.resultsJson} />
              <JsonBlock label="providerRawJson（原始返回）" value={log.providerRawJson} />
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

function truncateMid(s: string | null | undefined, n: number) {
  if (!s) return '—'
  if (s.length <= n) return s
  const head = Math.ceil(n / 2) - 1
  const tail = n - head - 1
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
