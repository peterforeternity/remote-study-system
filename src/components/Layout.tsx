import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  PenLine,
  Route,
  Blocks,
  Settings,
  LogOut,
  GraduationCap,
} from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: '仪表盘', icon: <LayoutDashboard size={18} />, roles: ['teacher', 'student', 'admin'] },
  { to: '/tasks', label: '任务管理', icon: <ClipboardList size={18} />, roles: ['teacher', 'admin'] },
  { to: '/assignments', label: '我的作业', icon: <FileText size={18} />, roles: ['student'] },
  { to: '/grading', label: '批改中心', icon: <PenLine size={18} />, roles: ['teacher', 'admin'] },
  { to: '/learning-path', label: '学习路径', icon: <Route size={18} />, roles: ['student', 'teacher'] },
  { to: '/skills', label: '科目技能', icon: <Blocks size={18} />, roles: ['teacher', 'admin'] },
  { to: '/settings', label: '设置', icon: <Settings size={18} />, roles: ['teacher', 'student', 'admin'] },
]

export function AppLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuthStore()
  const navigate = useNavigate()
  const role = profile?.role ?? 'student'

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <GraduationCap className="text-primary" size={24} />
          <span className="font-display text-lg font-semibold">远程学习</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.filter((i) => i.roles.includes(role)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-fg'
                    : 'text-fg hover:bg-border/40',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 px-2">
            <p className="text-sm font-medium">{profile?.name}</p>
            <p className="text-xs text-muted">
              {role === 'teacher' ? '教师' : role === 'admin' ? '管理员' : '学生'}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-danger hover:bg-danger/10"
          >
            <LogOut size={18} />
            退出登录
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* 移动端顶部栏 */}
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <GraduationCap className="text-primary" size={22} />
            <span className="font-display font-semibold">远程学习</span>
          </div>
          <button onClick={handleSignOut} className="text-danger">
            <LogOut size={20} />
          </button>
        </header>
        {/* 移动端底部导航 */}
        <nav className="fixed bottom-0 left-0 right-0 z-10 flex justify-around border-t border-border bg-surface py-2 md:hidden">
          {NAV_ITEMS.filter((i) => i.roles.includes(role))
            .slice(0, 5)
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-0.5 px-2 text-xs',
                    isActive ? 'text-primary' : 'text-muted',
                  )
                }
              >
                {item.icon}
              </NavLink>
            ))}
        </nav>

        <main className="flex-1 overflow-auto p-4 pb-20 md:p-8 md:pb-8">{children}</main>
      </div>
    </div>
  )
}
