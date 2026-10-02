'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, type PlatformSettings } from '@/components/admin/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Plug, TestTube, Save, AlertTriangle } from 'lucide-react'

export function SettingsView() {
  const { data, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<PlatformSettings>('/api/admin/settings'),
  })
  const [form, setForm] = useState<Partial<PlatformSettings> & Record<string, any>>({})

  const save = useMutation({
    mutationFn: (body: any) => api.put('/api/admin/settings', body),
    onSuccess: () => {
      toast.success('设置已保存')
      setForm({})
      refetch()
    },
    onError: (e: any) => toast.error(e.message ?? '保存失败'),
  })

  function field(path: string, fallback: any) {
    const v = form[path]
    return v !== undefined ? v : path.split('.').reduce<any>((o, k) => (o ? o[k] : ''), data) ?? fallback
  }
  function set(path: string, value: any) {
    setForm((f) => ({ ...f, [path]: value }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">平台设置</h1>
          <p className="text-sm text-muted-foreground">Qdrant 连接 · 嵌入模型 · 重排模型 · 检索默认参数</p>
        </div>
        <Button onClick={() => save.mutate(form)} disabled={save.isPending || Object.keys(form).length === 0}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          保存改动
        </Button>
      </div>

      <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle>嵌入/重排模型一致性（关键）</AlertTitle>
        <AlertDescription>
          嵌入模型必须与向量入库时完全一致（同 API Base + 同 Model + 同维度）；重排模型必须与检索侧一致。否则向量空间不匹配，召回结果无意义，重排序结果不可对比。入库侧以 LightRAG-Base 知识库设置为准。
        </AlertDescription>
      </Alert>

      {/* Qdrant */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" /> Qdrant 连接
          </CardTitle>
          <CardDescription>只读检索目标。本网关不直接写库，仅通过 Qdrant REST API 检索</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>服务地址</Label>
            <Input value={field('qdrant.url', '')} onChange={(e) => set('qdrant.url', e.target.value)} placeholder="http://qdrant:6333" />
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={form['qdrant.apiKey'] !== undefined ? form['qdrant.apiKey'] : ''}
                onChange={(e) => set('qdrant.apiKey', e.target.value)}
                placeholder={data?.qdrant.apiKeyConfigured ? '已配置（留空保持不变）' : '未配置'}
              />
              <TestButton target="qdrant" fields={{ url: field('qdrant.url', ''), apiKey: form['qdrant.apiKey'] }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Embedding */}
      <Card>
        <CardHeader>
          <CardTitle>嵌入模型 (Embedding)</CardTitle>
          <CardDescription className="text-amber-600 dark:text-amber-400">{data?.embedding.reminder}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>API Base</Label>
            <Input value={field('embedding.apiBase', '')} onChange={(e) => set('embedding.apiBase', e.target.value)} placeholder="https://your-embed-api/v1" />
          </div>
          <div className="space-y-2">
            <Label>模型 ID</Label>
            <Input value={field('embedding.model', '')} onChange={(e) => set('embedding.model', e.target.value)} placeholder="BAAI/bge-m3" />
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={form['embedding.apiKey'] !== undefined ? form['embedding.apiKey'] : ''}
                onChange={(e) => set('embedding.apiKey', e.target.value)}
                placeholder={data?.embedding.apiKeyConfigured ? '已配置（留空保持不变）' : '未配置'}
              />
              <TestButton target="embedding" fields={{ apiBase: field('embedding.apiBase', ''), apiKey: form['embedding.apiKey'], model: field('embedding.model', '') }} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>向量维度（探测值，0=未知）</Label>
            <Input type="number" value={field('embedding.dim', 0)} onChange={(e) => set('embedding.dim', Number(e.target.value))} />
          </div>
        </CardContent>
      </Card>

      {/* Rerank */}
      <Card>
        <CardHeader>
          <CardTitle>重排模型 (Rerank)</CardTitle>
          <CardDescription className="text-amber-600 dark:text-amber-400">{data?.rerank.reminder}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>API Base</Label>
            <Input value={field('rerank.apiBase', '')} onChange={(e) => set('rerank.apiBase', e.target.value)} placeholder="https://your-embed-api/v1" />
          </div>
          <div className="space-y-2">
            <Label>模型 ID</Label>
            <Input value={field('rerank.model', '')} onChange={(e) => set('rerank.model', e.target.value)} placeholder="bge-reranker-v2-m3" />
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={form['rerank.apiKey'] !== undefined ? form['rerank.apiKey'] : ''}
                onChange={(e) => set('rerank.apiKey', e.target.value)}
                placeholder={data?.rerank.apiKeyConfigured ? '已配置（留空保持不变）' : '未配置'}
              />
              <TestButton target="rerank" fields={{ apiBase: field('rerank.apiBase', ''), apiKey: form['rerank.apiKey'], model: field('rerank.model', '') }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 检索默认 */}
      <Card>
        <CardHeader>
          <CardTitle>检索默认参数</CardTitle>
          <CardDescription>未在请求中显式指定时的兜底值（与 LightRAG-Base runSearch 对齐）</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>默认 topK</Label>
            <Input type="number" value={field('defaults.topK', 5)} onChange={(e) => set('defaults.topK', Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>默认 prefetchLimit</Label>
            <Input type="number" value={field('defaults.prefetchLimit', 50)} onChange={(e) => set('defaults.prefetchLimit', Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>默认 mode</Label>
            <Select value={field('defaults.mode', 'hybrid')} onValueChange={(v) => set('defaults.mode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hybrid">hybrid（双路 + 融合）</SelectItem>
                <SelectItem value="dense">dense（仅稠密）</SelectItem>
                <SelectItem value="sparse">sparse（仅稀疏）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>默认 fusion</Label>
            <Select value={field('defaults.fusion', 'rrf')} onValueChange={(v) => set('defaults.fusion', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rrf">RRF</SelectItem>
                <SelectItem value="dbsf">DBSF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>RRF K</Label>
            <Input type="number" value={field('defaults.rrfK', 60)} onChange={(e) => set('defaults.rrfK', Number(e.target.value))} />
          </div>
          <div className="flex items-end gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={field('defaults.rerank', false)} onCheckedChange={(v) => set('defaults.rerank', v)} id="dr" />
              <Label htmlFor="dr">默认开启 rerank</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 限流 / 保留 / 开关 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>限流默认</CardTitle>
            <CardDescription>租户未配置时的兜底（-1=无限）</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>每分钟请求数</Label>
              <Input type="number" value={field('rateLimit.defaultRatePerMin', 60)} onChange={(e) => set('rateLimit.defaultRatePerMin', Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>每日配额</Label>
              <Input type="number" value={field('rateLimit.defaultDailyQuota', 10000)} onChange={(e) => set('rateLimit.defaultDailyQuota', Number(e.target.value))} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>日志保留（天）</CardTitle>
            <CardDescription>过期自动清理</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>调用日志</Label>
              <Input type="number" value={field('retention.callLogDays', 30)} onChange={(e) => set('retention.callLogDays', Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>重排日志</Label>
              <Input type="number" value={field('retention.rerankLogDays', 30)} onChange={(e) => set('retention.rerankLogDays', Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>审计日志</Label>
              <Input type="number" value={field('retention.auditLogDays', 365)} onChange={(e) => set('retention.auditLogDays', Number(e.target.value))} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>平台开关</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">只读熔断</div>
              <div className="text-sm text-muted-foreground">紧急止血：开启后所有检索直接返回 503</div>
            </div>
            <Switch checked={field('switches.readonlyCircuitBreaker', false)} onCheckedChange={(v) => set('switches.readonlyCircuitBreaker', v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">跨租户 KB 共享</div>
              <div className="text-sm text-muted-foreground">允许租户检索非归属的 KB（关闭=KB 必须归属请求租户）</div>
            </div>
            <Switch checked={field('switches.allowCrossTenantKb', false)} onCheckedChange={(v) => set('switches.allowCrossTenantKb', v)} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function TestButton({ target, fields }: { target: 'qdrant' | 'embedding' | 'rerank'; fields: Record<string, any> }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string; dim?: number }>('/api/admin/settings/test', { target, ...fields }),
    onSuccess: (r) => {
      setResult(r)
      if (r.ok) {
        toast.success(r.message)
      } else {
        toast.error(r.message)
      }
    },
    onError: (e: any) => {
      setResult({ ok: false, message: e.message ?? '测试失败' })
      toast.error(e.message ?? '测试失败')
    },
  })
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending} className="shrink-0">
      {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube className="h-4 w-4" />}
      {result ? (result.ok ? <Badge className="ml-1 bg-emerald-500">✓</Badge> : <Badge className="ml-1 bg-red-500">✗</Badge>) : null}
    </Button>
  )
}
