'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/components/admin/api'
import { LoginView } from '@/components/admin/views/LoginView'
import { BootstrapView } from '@/components/admin/views/BootstrapView'
import { AppShell } from '@/components/admin/AppShell'

export default function Page() {
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null)
  useEffect(() => {
    api
      .get<{ bootstrapped: boolean; adminCount: number }>('/api/admin/bootstrap')
      .then((r) => setBootstrapped(r.bootstrapped))
      .catch(() => setBootstrapped(false))
  }, [])

  const meQuery = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => api.get<{ authenticated: boolean; user?: { id: string; username: string; role: string } }>('/api/admin/auth/me'),
    enabled: bootstrapped === true,
    retry: false,
  })

  if (bootstrapped === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">加载中…</div>
      </div>
    )
  }
  if (bootstrapped === false) {
    return <BootstrapView onDone={() => setBootstrapped(true)} />
  }
  if (meQuery.isLoading || !meQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">检查登录状态…</div>
      </div>
    )
  }
  if (!meQuery.data.authenticated) {
    return <LoginView onDone={() => meQuery.refetch()} />
  }
  return <AppShell user={meQuery.data.user!} onLogout={() => meQuery.refetch()} />
}
