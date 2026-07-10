import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GraduationCap, AlertCircle } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'

// 种子测试账号，便于快速体验
const DEMO_ACCOUNTS = [
  { label: '教师', email: 'teacher@example.com' },
  { label: '学生', email: 'student1@example.com' },
  { label: '管理员', email: 'admin@example.com' },
]

export default function Login() {
  const navigate = useNavigate()
  const { signIn, loading } = useAuthStore()
  const [email, setEmail] = useState('teacher@example.com')
  const [password, setPassword] = useState('Passw0rd!')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请检查账号密码')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-soft">
        <div className="mb-6 flex flex-col items-center text-center">
          <GraduationCap className="mb-2 text-primary" size={40} />
          <h1 className="font-display text-2xl font-semibold">远程指导学习系统</h1>
          <p className="mt-1 text-sm text-muted">教师与学生实时协作的学习平台</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>
              尚未配置 Supabase 环境变量。请在 <code>.env</code> 中填入
              <code> VITE_SUPABASE_URL</code> 与
              <code> VITE_SUPABASE_PUBLISHABLE_KEY</code> 后重启。
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              邮箱
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="password">
              密码
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <AlertCircle size={14} />
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>

        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2 text-xs text-muted">测试账号（密码统一 Passw0rd!）：</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                onClick={() => {
                  setEmail(a.email)
                  setPassword('Passw0rd!')
                }}
                className="rounded border border-border px-2.5 py-1 text-xs hover:bg-bg"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
