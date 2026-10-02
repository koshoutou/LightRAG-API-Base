'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type UsageResponse } from '@/components/admin/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Loader2,
  RefreshCw,
  Search,
  AlertTriangle,
  ShieldAlert,
  ListOrdered,
  Gauge,
  Activity,
  Coins,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const DAY_OPTIONS = [1, 7, 14, 30, 90]

interface DailyAgg {
  date: string
  searchCount: number
  errorCount: number
  rateLimitedCount: number
  rerankCount: number
}

export function UsageView() {
  const [days, setDays] = useState(7)
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['usage', days],
    queryFn: () => api.get<UsageResponse>(`/api/admin/usage?days=${days}`),
  })

  const s = data?.summary
  const byTenant = (data?.byTenant ?? []).slice().sort((a, b) => b.searchCount - a.searchCount)
  const daily = aggregateDaily(data?.daily ?? [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">计量统计</h1>
          <p className="text-sm text-muted-foreground">检索调用与重排计费维度统计</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((d) => (<SelectItem key={d} value={String(d)}>最近 {d} 天</SelectItem>))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        </div>
      ) : !s ? (
        <div className="py-16 text-center text-sm text-muted-foreground">暂无数据</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="总检索数" value={s.searchCount} icon={Search} tone="emerald" />
            <StatCard title="错误数" value={s.errorCount} icon={AlertTriangle} tone="red" />
            <StatCard title="限流数" value={s.rateLimitedCount} icon={ShieldAlert} tone="amber" />
            <StatCard title="重排次数" value={s.rerankCount} icon={ListOrdered} tone="emerald" />
            <StatCard title="平均延迟(ms)" value={s.avgLatencyMs} icon={Gauge} tone="primary" />
            <StatCard title="最大延迟(ms)" value={s.latencyMaxMs} icon={Activity} tone="primary" />
            <StatCard title="embed tokens" value={s.embedTokens} icon={Coins} tone="primary" />
            <StatCard title="rerank docs" value={s.rerankDocuments} icon={FileText} tone="primary" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>每日检索量趋势</CardTitle>
              <CardDescription>
                {data?.sinceDate ? `从 ${new Date(data.sinceDate).toLocaleDateString('zh-CN')} 至今` : '趋势统计'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {daily.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                        stroke="var(--border)"
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                        stroke="var(--border)"
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--popover)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: 'var(--foreground)',
                        }}
                        labelStyle={{ color: 'var(--foreground)' }}
                        cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
                      />
                      <Bar dataKey="searchCount" name="检索数" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>按租户汇总</CardTitle>
              <CardDescription>按检索数降序排列</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {byTenant.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>租户</TableHead>
                        <TableHead>检索数</TableHead>
                        <TableHead>错误数</TableHead>
                        <TableHead>限流数</TableHead>
                        <TableHead>重排数</TableHead>
                        <TableHead>平均延迟</TableHead>
                        <TableHead>最大延迟</TableHead>
                        <TableHead>embedTokens</TableHead>
                        <TableHead>rerankDocs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byTenant.map((t) => (
                        <TableRow key={t.tenantId}>
                          <TableCell>
                            <div className="font-medium">{t.tenant?.name ?? '—'}</div>
                            <div className="font-mono text-xs text-muted-foreground">{t.tenant?.slug ?? t.tenantId}</div>
                          </TableCell>
                          <TableCell className="tabular-nums">{t.searchCount}</TableCell>
                          <TableCell className="tabular-nums">{t.errorCount}</TableCell>
                          <TableCell className="tabular-nums">{t.rateLimitedCount}</TableCell>
                          <TableCell className="tabular-nums">{t.rerankCount}</TableCell>
                          <TableCell className="tabular-nums">{t.avgLatencyMs}ms</TableCell>
                          <TableCell className="tabular-nums">{t.latencyMaxMs}ms</TableCell>
                          <TableCell className="tabular-nums">{t.embedTokens}</TableCell>
                          <TableCell className="tabular-nums">{t.rerankDocuments}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string
  value: number
  icon: React.ElementType
  tone: 'emerald' | 'red' | 'amber' | 'primary'
}) {
  const toneClass = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    primary: 'text-foreground',
  }[tone]
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className={cn('text-2xl font-semibold tabular-nums', toneClass)}>{value.toLocaleString()}</div>
        </div>
        <Icon className={cn('h-8 w-8 opacity-20', toneClass)} />
      </CardContent>
    </Card>
  )
}

function aggregateDaily(rows: UsageResponse['daily']): DailyAgg[] {
  const map = new Map<string, DailyAgg>()
  for (const r of rows) {
    const day = r.date.slice(0, 10)
    const cur = map.get(day) ?? { date: day, searchCount: 0, errorCount: 0, rateLimitedCount: 0, rerankCount: 0 }
    cur.searchCount += r.searchCount
    cur.errorCount += r.errorCount
    cur.rateLimitedCount += r.rateLimitedCount
    cur.rerankCount += r.rerankCount
    map.set(day, cur)
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}
