'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ApiKey, type Tenant } from '@/components/admin/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Plus, KeyRound, Copy, Ban, Loader2, ShieldCheck } from 'lucide-react'

export function ApiKeysView() {
  const [tenantFilter, setTenantFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createdKey, setCreatedKey] = useState<{ key: string; apiKey: ApiKey } | null>(null)

  const list = useQuery({
    queryKey: ['apikeys', tenantFilter],
    queryFn: () => api.get<{ items: ApiKey[]; total: number }>(`/api/admin/apikeys?tenantId=${encodeURIComponent(tenantFilter)}&limit=200`),
  })
  const tenants = useQuery({ queryKey: ['tenants-for-select'], queryFn: () => api.get<{ items: Tenant[] }>('/api/admin/tenants?limit=500') })

  const revoke = useMutation({
    mutationFn: ({ id, revoke }: { id: string; revoke: boolean }) =>
      api.patch(`/api/admin/apikeys/${id}`, { revoke }),
    onSuccess: (_, v) => {
      toast.success(v.revoke ? 'API Key 已吊销' : '已恢复')
      list.refetch()
    },
    onError: (e: any) => toast.error(e.message ?? '操作失败'),
  })

  function copyKey(k: string) {
    navigator.clipboard.writeText(k).then(() => toast.success('已复制到剪贴板'))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Key 管理</h1>
          <p className="text-sm text-muted-foreground">检索网关鉴权凭据 · 明文仅创建时返回一次</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> 新建 API Key
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>API Key 列表</CardTitle>
            <CardDescription>共 {list.data?.total ?? 0} 个</CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="全部租户" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部租户</SelectItem>
                {(tenants.data?.items ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>刷新</Button>
          </div>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="py-12 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
          ) : (list.data?.items ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <KeyRound className="mx-auto mb-2 h-8 w-8 opacity-40" />
              暂无 API Key
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>前缀</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">调用次数</TableHead>
                    <TableHead>最后使用</TableHead>
                    <TableHead>过期</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(list.data?.items ?? []).map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell><code className="text-xs">{k.keyPrefix}</code></TableCell>
                      <TableCell>
                        <Badge variant={k.role === 'admin' ? 'default' : k.role === 'operator' ? 'secondary' : 'outline'}>{k.role}</Badge>
                      </TableCell>
                      <TableCell>
                        {k.revokedAt ? <Badge variant="destructive">已吊销</Badge> : k.enabled ? <Badge className="bg-emerald-500">启用</Badge> : <Badge variant="secondary">禁用</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{k.callCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('zh-CN') : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('zh-CN') : '永久'}</TableCell>
                      <TableCell className="text-right">
                        {k.revokedAt ? (
                          <Button variant="ghost" size="sm" onClick={() => revoke.mutate({ id: k.id, revoke: false })}>恢复</Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => { if (confirm('吊销此 API Key？')) revoke.mutate({ id: k.id, revoke: true }) }}>
                            <Ban className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {createOpen && (
        <CreateKeyDialog
          tenants={tenants.data?.items ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={(r) => { setCreateOpen(false); setCreatedKey(r); list.refetch() }}
        />
      )}

      {createdKey && (
        <Dialog open onOpenChange={() => setCreatedKey(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-500" /> API Key 创建成功</DialogTitle>
              <DialogDescription className="text-amber-600 dark:text-amber-400">⚠ 明文密钥仅此一次显示，请立即保存到密钥管理器</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="rounded-md border bg-muted p-3">
                <code className="break-all text-xs">{createdKey.key}</code>
              </div>
              <Button variant="outline" size="sm" onClick={() => copyKey(createdKey.key)}>
                <Copy className="mr-2 h-4 w-4" /> 复制密钥
              </Button>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">使用方式</div>
                <pre className="mt-1 whitespace-pre-wrap">POST /api/v1/search
Authorization: Bearer {createdKey.key}
Content-Type: application/json
{`{"kbId":"...","query":"...","mode":"hybrid","topK":5}`}</pre>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setCreatedKey(null)}>我已保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function CreateKeyDialog({ tenants, onClose, onCreated }: { tenants: Tenant[]; onClose: () => void; onCreated: (r: { key: string; apiKey: ApiKey }) => void }) {
  const [tenantId, setTenantId] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'readonly' | 'operator' | 'admin'>('readonly')
  const [ratePerMinOverride, setRatePerMin] = useState(0)
  const [dailyQuotaOverride, setDailyQuota] = useState(0)
  const [expiresAt, setExpiresAt] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.post<{ apiKey: ApiKey; key: string }>('/api/admin/apikeys', {
        tenantId,
        name,
        role,
        ratePerMinOverride,
        dailyQuotaOverride,
        expiresAt: expiresAt || undefined,
      }),
    onSuccess: (r) => { toast.success('API Key 已创建'); onCreated(r) },
    onError: (e: any) => toast.error(e.message ?? '创建失败'),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建 API Key</DialogTitle>
          <DialogDescription>绑定租户、角色、配额覆盖与过期时间</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>租户</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger><SelectValue placeholder="选择租户" /></SelectTrigger>
              <SelectContent>
                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.slug})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：Hermes 检索 Agent" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>角色</Label>
              <Select value={role} onValueChange={(v) => setRole(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="readonly">readonly（仅检索，无 debug）</SelectItem>
                  <SelectItem value="operator">operator（可 debug）</SelectItem>
                  <SelectItem value="admin">admin（管理权限）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>过期时间（可选）</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>限流/分覆盖（0=跟随租户 -1=无限）</Label>
              <Input type="number" value={ratePerMinOverride} onChange={(e) => setRatePerMin(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>日配额覆盖（0=跟随租户 -1=无限）</Label>
              <Input type="number" value={dailyQuotaOverride} onChange={(e) => setDailyQuota(Number(e.target.value))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !tenantId || !name}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
