import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'
import { AppLayout } from './Layout'

// ============================================================
// 路由守卫：未登录跳转 /login。
// 注意：这里的角色判断仅用于前端导航体验，真正的数据权限由 RLS 保证。
// ============================================================

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, initialized } = useAuthStore()

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        正在加载…
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <AppLayout>{children}</AppLayout>
}
