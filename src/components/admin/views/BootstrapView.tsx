'use client'

import { useState } from 'react'
import { api, ApiError } from '@/components/admin/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { toast } from 'sonner'

export function BootstrapView({ onDone }: { onDone: () => void }) {
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      await api.post('/api/admin/bootstrap', { bootstrapToken, username, password })
      toast.success('管理员创建成功，请登录')
      onDone()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '引导失败'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/40 p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">首次部署引导</CardTitle>
          <CardDescription>创建首个管理员账户。引导令牌来自 .env 的 ADMIN_BOOTSTRAP_TOKEN</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTitle>安全提示</AlertTitle>
              <AlertDescription>
                引导完成后此端点自动关闭。建议立即在 .env 配置 ADMIN_BOOTSTRAP_TOKEN 并定期轮换管理员密码。
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="bt">引导令牌（ADMIN_BOOTSTRAP_TOKEN）</Label>
              <Input
                id="bt"
                type="password"
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                placeholder="若 .env 未设置则留空"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bu">用户名</Label>
                <Input id="bu" value={username} onChange={(e) => setUsername(e.target.value)} pattern="[a-zA-Z0-9_-]{3,32}" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bp">密码（≥8 位）</Label>
                <Input id="bp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bc">确认密码</Label>
              <Input id="bc" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '创建中…' : '创建管理员并继续'}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
