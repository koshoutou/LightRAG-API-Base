'use client'

import { useState } from 'react'
import { api } from '@/components/admin/api'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  LayoutDashboard,
  Settings,
  Users,
  KeyRound,
  Database,
  ScrollText,
  ListOrdered,
  ShieldCheck,
  BarChart3,
  LogOut,
  Server,
} from 'lucide-react'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { TenantsView } from './views/TenantsView'
import { ApiKeysView } from './views/ApiKeysView'
import { KbMappingsView } from './views/KbMappingsView'
import { CallLogsView } from './views/CallLogsView'
import { RerankLogsView } from './views/RerankLogsView'
import { AuditLogsView } from './views/AuditLogsView'
import { UsageView } from './views/UsageView'
import { cn } from '@/lib/utils'

type ViewId =
  | 'dashboard'
  | 'settings'
  | 'tenants'
  | 'apikeys'
  | 'kbmappings'
  | 'calllogs'
  | 'reranklogs'
  | 'auditlogs'
  | 'usage'

const NAV: { id: ViewId; label: string; icon: React.ElementType; group: string }[] = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard, group: '概览' },
  { id: 'usage', label: '计量统计', icon: BarChart3, group: '概览' },
  { id: 'settings', label: '平台设置', icon: Settings, group: '控制面' },
  { id: 'tenants', label: '租户管理', icon: Users, group: '控制面' },
  { id: 'apikeys', label: 'API Key', icon: KeyRound, group: '控制面' },
  { id: 'kbmappings', label: '知识库映射', icon: Database, group: '控制面' },
  { id: 'calllogs', label: '调用日志', icon: ScrollText, group: '审计' },
  { id: 'reranklogs', label: '重排日志', icon: ListOrdered, group: '审计' },
  { id: 'auditlogs', label: '审计日志', icon: ShieldCheck, group: '审计' },
]

export function AppShell({ user, onLogout }: { user: { id: string; username: string; role: string }; onLogout: () => void }) {
  const [view, setView] = useState<ViewId>('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)

  async function logout() {
    await api.post('/api/admin/auth/logout').catch(() => {})
    onLogout()
  }

  const groups = [...new Set(NAV.map((n) => n.group))]

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <button
            className="rounded-md p-2 hover:bg-muted md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="切换菜单"
          >
            <Server className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Server className="h-4 w-4" />
            </div>
            <div className="font-semibold">LightRAG-API-Base</div>
            <span className="hidden text-xs text-muted-foreground sm:inline">· 检索审计网关</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-none">{user.username}</div>
              <div className="text-xs text-muted-foreground">{user.role}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} aria-label="退出登录">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 top-14 z-30 w-56 shrink-0 border-r bg-background transition-transform md:static md:top-0 md:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3">
            {groups.map((g) => (
              <div key={g} className="mb-2">
                <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{g}</div>
                {NAV.filter((n) => n.group === g).map((n) => {
                  const Icon = n.icon
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        setView(n.id)
                        setMobileOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                        view === n.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{n.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
            <Separator className="my-2" />
            <div className="px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">只读 + 控制面</div>
              <div>不直接碰向量库</div>
            </div>
          </nav>
        </aside>

        {mobileOpen && <div className="fixed inset-0 top-14 z-20 bg-black/30 md:hidden" onClick={() => setMobileOpen(false)} />}

        <main className="flex-1 overflow-x-hidden p-4 md:p-6">
          {view === 'dashboard' && <DashboardView />}
          {view === 'settings' && <SettingsView />}
          {view === 'tenants' && <TenantsView />}
          {view === 'apikeys' && <ApiKeysView />}
          {view === 'kbmappings' && <KbMappingsView />}
          {view === 'calllogs' && <CallLogsView />}
          {view === 'reranklogs' && <RerankLogsView />}
          {view === 'auditlogs' && <AuditLogsView />}
          {view === 'usage' && <UsageView />}
        </main>
      </div>

      <footer className="mt-auto border-t bg-background px-4 py-3 text-center text-xs text-muted-foreground">
        LightRAG-API-Base · 企业级 Qdrant 检索审计网关 · 嵌入/重排模型须与入库一致 · 多租户计量
      </footer>
    </div>
  )
}
