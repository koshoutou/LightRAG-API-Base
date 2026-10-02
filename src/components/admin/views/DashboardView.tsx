'use client'

import { useQuery } from '@tanstack/react-query'
import { api, type HealthResponse, type CallLog } from '@/components/admin/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle2, XCircle, AlertTriangle, Activity, Zap, Gauge, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DashboardView() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<HealthResponse>('/api/v1/health'), refetchInterval: 30_000 })
  const recentCalls = useQuery({
    queryKey: ['recent-calls'],
    queryFn: () => api.get<{ items: CallLog[]; total: number }>('/api/admin/call-logs?limit=8'),
    refetchInterval: 15_000,
  })

  const h = health.data?.checks
  const calls = recentCalls.data?.items ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">仪表盘</h1>
        <p className="text-sm text-muted-foreground">检索审计网关实时状态与最近调用</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Qdrant 连接"
          value={h?.qdrant.reachable ? '可达' : '不可达'}
          sub={h?.qdrant.version ? `v${h.qdrant.version}` : h?.qdrant.configured ? '已配置' : '未配置'}
          icon={ShieldCheck}
          tone={h?.qdrant.reachable ? 'ok' : 'warn'}
        />
        <StatCard
          title="嵌入模型"
          value={h?.embedding.configured ? '就绪' : '未配置'}
          sub={h?.embedding.model ?? '—'}
          icon={Zap}
          tone={h?.embedding.configured ? 'ok' : 'warn'}
        />
        <StatCard
          title="重排模型"
          value={h?.rerank.configured ? '就绪' : '未配置'}
          sub={h?.rerank.model ?? '—'}
          icon={Activity}
          tone={h?.rerank.configured ? 'ok' : 'warn'}
        />
        <StatCard
          title="熔断状态"
          value={h?.circuitBreaker === 'OPEN' ? '已熔断' : '闭合'}
          sub={h?.circuitBreaker === 'OPEN' ? '检索拒绝中' : '正常检索'}
          icon={Gauge}
          tone={h?.circuitBreaker === 'OPEN' ? 'err' : 'ok'}
        />
      </div>

      {health.data?.reminder && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <div className="font-medium text-amber-900 dark:text-amber-200">一致性提醒</div>
              <div className="text-amber-800 dark:text-amber-300">{health.data.reminder}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>最近检索调用</CardTitle>
            <CardDescription>最新 8 条 /api/v1/search 调用</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => recentCalls.refetch()}>
            刷新
          </Button>
        </CardHeader>
        <CardContent>
          {calls.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无调用记录</div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-2">
                {calls.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted/50"
                  >
                    <StatusBadge status={c.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{c.query.slice(0, 80)}</div>
                      <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                        <span>{c.mode}</span>
                        <span>topK={c.topK}</span>
                        <span>{c.tookMs}ms</span>
                        <span>{c.resultCount} 结果</span>
                        <span className="truncate">{c.collection}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleTimeString('zh-CN')}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  title: string
  value: string
  sub: string
  icon: React.ElementType
  tone: 'ok' | 'warn' | 'err'
}) {
  const toneClass = {
    ok: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    err: 'text-red-600 dark:text-red-400',
  }[tone]
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className={cn('text-lg font-semibold', toneClass)}>{value}</div>
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        </div>
        <Icon className={cn('h-8 w-8 opacity-20', toneClass)} />
      </CardContent>
    </Card>
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
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', cfg.cls)}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  )
}
