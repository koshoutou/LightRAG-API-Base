'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type KbMapping, type Tenant } from '@/components/admin/api'
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
import { Plus, Pencil, Trash2, Database, Loader2, Link2 } from 'lucide-react'

export function KbMappingsView() {
  const [tenantFilter, setTenantFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<KbMapping | null>(null)

  const list = useQuery({
    queryKey: ['kbmappings', tenantFilter],
    queryFn: () => api.get<{ items: KbMapping[]; total: number }>(`/api/admin/kb-mappings?tenantId=${encodeURIComponent(tenantFilter)}&limit=200`),
  })
  const tenants = useQuery({ queryKey: ['tenants-for-kb'], queryFn: () => api.get<{ items: Tenant[] }>('/api/admin/tenants?limit=500') })

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/kb-mappings/${id}`),
    onSuccess: () => { toast.success('映射已删除'); list.refetch() },
    onError: (e: any) => toast.error(e.message ?? '删除失败'),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">知识库映射</h1>
          <p className="text-sm text-muted-foreground">注册"租户 → kbId → Qdrant 集合"的检索授权关系</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> 新建映射
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>映射列表</CardTitle>
            <CardDescription>共 {list.data?.total ?? 0} 条</CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="全部租户" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部租户</SelectItem>
                {(tenants.data?.items ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
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
              <Database className="mx-auto mb-2 h-8 w-8 opacity-40" />
              暂无映射
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>租户</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>kbId</TableHead>
                    <TableHead>collection</TableHead>
                    <TableHead className="text-right">dim</TableHead>
                    <TableHead>嵌入模型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(list.data?.items ?? []).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs">{m.tenant?.name ?? m.tenantId.slice(0, 8)}</TableCell>
                      <TableCell className="font-medium">{m.name || '—'}</TableCell>
                      <TableCell><code className="text-xs">{m.kbId.slice(0, 12)}…</code></TableCell>
                      <TableCell><code className="text-xs">{m.collection}</code></TableCell>
                      <TableCell className="text-right font-mono text-xs">{m.dim || '—'}</TableCell>
                      <TableCell className="text-xs">{m.embeddingModel || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={m.enabled ? 'default' : 'secondary'} className={m.enabled ? 'bg-emerald-500' : ''}>
                          {m.enabled ? '启用' : '停用'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setEditTarget(m)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm('删除此映射？')) remove.mutate(m.id) }}><Trash2 className="h-4 w-4" /></Button>
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
        <KbMappingDialog
          mapping={editTarget}
          tenants={tenants.data?.items ?? []}
          onClose={() => { setCreateOpen(false); setEditTarget(null) }}
          onSaved={() => { setCreateOpen(false); setEditTarget(null); list.refetch() }}
        />
      )}
    </div>
  )
}

function KbMappingDialog({ mapping, tenants, onClose, onSaved }: { mapping: KbMapping | null; tenants: Tenant[]; onClose: () => void; onSaved: () => void }) {
  const [tenantId, setTenantId] = useState(mapping?.tenantId ?? '')
  const [kbId, setKbId] = useState(mapping?.kbId ?? '')
  const [collection, setCollection] = useState(mapping?.collection ?? '')
  const [name, setName] = useState(mapping?.name ?? '')
  const [dim, setDim] = useState(mapping?.dim ?? 0)
  const [embeddingModel, setEmbeddingModel] = useState(mapping?.embeddingModel ?? '')
  const [enabled, setEnabled] = useState(mapping?.enabled ?? true)

  const save = useMutation({
    mutationFn: async () => {
      const body = { collection, name, dim, embeddingModel, enabled }
      if (mapping) return api.put(`/api/admin/kb-mappings/${mapping.id}`, body)
      return api.post('/api/admin/kb-mappings', { tenantId, kbId, ...body })
    },
    onSuccess: () => { toast.success(mapping ? '映射已更新' : '映射已创建'); onSaved() },
    onError: (e: any) => toast.error(e.message ?? '保存失败'),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> {mapping ? '编辑映射' : '新建映射'}</DialogTitle>
          <DialogDescription>关联租户与 Qdrant 集合，支持检索授权</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {!mapping && (
            <>
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
                <Label>知识库 ID (kbId)</Label>
                <Input value={kbId} onChange={(e) => setKbId(e.target.value)} placeholder="LightRAG-Base 中的 KB cuid" />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label>Qdrant collection</Label>
            <Input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="kb_xxxxxxxxxxxx" />
          </div>
          <div className="space-y-2">
            <Label>友好名</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：产品手册库" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>向量维度（0=未知）</Label>
              <Input type="number" value={dim} onChange={(e) => setDim(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>入库嵌入模型（一致性提醒用）</Label>
              <Input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} placeholder="BAAI/bge-m3" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="kbe" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            <Label htmlFor="kbe">启用</Label>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ 嵌入模型须与入库时一致；填写后网关会在检索时校验并告警不一致情况
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!mapping && (!tenantId || !kbId || !collection))}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
