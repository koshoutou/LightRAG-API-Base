'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Tenant } from '@/components/admin/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, Users } from 'lucide-react'

export function TenantsView() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Tenant | null>(null)

  const list = useQuery({
    queryKey: ['tenants', search],
    queryFn: () => api.get<{ items: Tenant[]; total: number }>(`/api/admin/tenants?search=${encodeURIComponent(search)}&limit=200`),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/tenants/${id}`),
    onSuccess: () => {
      toast.success('租户已删除')
      qc.invalidateQueries({ queryKey: ['tenants'] })
    },
    onError: (e: any) => toast.error(e.message ?? '删除失败'),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">租户管理</h1>
          <p className="text-sm text-muted-foreground">多租户隔离主体 · 配额与限流</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> 新建租户
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>租户列表</CardTitle>
            <CardDescription>共 {list.data?.total ?? 0} 个租户</CardDescription>
          </div>
          <div className="flex gap-2">
            <Input placeholder="搜索名称/slug" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>刷新</Button>
          </div>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="py-12 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
          ) : (list.data?.items ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 h-8 w-8 opacity-40" />
              暂无租户，请新建
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">限流/分</TableHead>
                    <TableHead className="text-right">日配额</TableHead>
                    <TableHead className="text-right">API Key</TableHead>
                    <TableHead className="text-right">KB 映射</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(list.data?.items ?? []).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <div>{t.name}</div>
                        {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                      </TableCell>
                      <TableCell><code className="text-xs">{t.slug}</code></TableCell>
                      <TableCell>
                        <Badge variant={t.enabled ? 'default' : 'secondary'}>{t.enabled ? '启用' : '停用'}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{t.ratePerMin === 0 ? '默认' : t.ratePerMin === -1 ? '∞' : t.ratePerMin}</TableCell>
                      <TableCell className="text-right">{t.dailyQuota === 0 ? '默认' : t.dailyQuota === -1 ? '∞' : t.dailyQuota}</TableCell>
                      <TableCell className="text-right">{t._count?.apiKeys ?? 0}</TableCell>
                      <TableCell className="text-right">{t._count?.kbMappings ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setEditTarget(t)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm(`删除租户 ${t.name}？关联数据将级联删除`)) remove.mutate(t.id) }}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {(createOpen || editTarget) && (
        <TenantDialog
          tenant={editTarget}
          onClose={() => { setCreateOpen(false); setEditTarget(null) }}
          onSaved={() => { setCreateOpen(false); setEditTarget(null); list.refetch() }}
        />
      )}
    </div>
  )
}

function TenantDialog({ tenant, onClose, onSaved }: { tenant: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tenant?.name ?? '')
  const [slug, setSlug] = useState(tenant?.slug ?? '')
  const [description, setDescription] = useState(tenant?.description ?? '')
  const [ratePerMin, setRatePerMin] = useState(tenant?.ratePerMin ?? 0)
  const [dailyQuota, setDailyQuota] = useState(tenant?.dailyQuota ?? 0)
  const [contact, setContact] = useState(tenant?.contact ?? '')
  const [enabled, setEnabled] = useState(tenant?.enabled ?? true)

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, slug, description, ratePerMin, dailyQuota, contact, enabled }
      if (tenant) {
        return api.put(`/api/admin/tenants/${tenant.id}`, body)
      }
      return api.post('/api/admin/tenants', body)
    },
    onSuccess: () => { toast.success(tenant ? '租户已更新' : '租户已创建'); onSaved() },
    onError: (e: any) => toast.error(e.message ?? '保存失败'),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tenant ? '编辑租户' : '新建租户'}</DialogTitle>
          <DialogDescription>配置租户名称、slug、配额与限流</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="小写字母数字横线" disabled={!!tenant} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>限流/分（0=默认 -1=无限）</Label>
              <Input type="number" value={ratePerMin} onChange={(e) => setRatePerMin(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>日配额（0=默认 -1=无限）</Label>
              <Input type="number" value={dailyQuota} onChange={(e) => setDailyQuota(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>联系人</Label>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="te" />
            <Label htmlFor="te">启用</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
