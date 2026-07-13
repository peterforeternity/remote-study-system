import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { GraduationCap, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'

// ============================================================
// 学生自助注册页。
// 角色固定为学生；所属机构由邀请码在后端决定（前端无法指定角色/机构）。
// ============================================================

interface FieldErrors {
  name?: string
  email?: string
  password?: string
  confirm?: string
  inviteCode?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Register() {
  const navigate = useNavigate()
  const { signUp, loading } = useAuthStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<null | 'active' | 'confirm'>(null)

  const validate = (): boolean => {
    const e: FieldErrors = {}
    if (name.trim().length < 2) e.name = '请输入真实姓名（至少 2 个字）'
    if (!EMAIL_RE.test(email)) e.email = '请输入有效的邮箱地址'
    if (password.length < 8) e.password = '密码至少 8 位'
    else if (!/[a-zA-Z]/.test(password) || !/\d/.test(password))
      e.password = '密码需同时包含字母和数字'
    if (confirm !== password) e.confirm = '两次输入的密码不一致'
    if (inviteCode.trim().length < 4) e.inviteCode = '请输入教师提供的邀请码'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setFormError(null)
    if (!validate()) return
    try {
      const { needsConfirmation } = await signUp({
        email: email.trim(),
        password,
        name: name.trim(),
        inviteCode: inviteCode.trim().toUpperCase(),
      })
      if (needsConfirmation) {
        setDone('confirm')
      } else {
        setDone('active')
        setTimeout(() => navigate('/dashboard'), 1200)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '注册失败，请稍后重试'
      // 后端触发器对无效邀请码抛出的错误做友好提示
      if (/invite|邀请码/i.test(msg)) {
        setErrors((p) => ({ ...p, inviteCode: '邀请码无效或已过期' }))
      } else if (/already|registered|exists/i.test(msg)) {
        setErrors((p) => ({ ...p, email: '该邮箱已注册，请直接登录' }))
      } else {
        setFormError(msg)
      }
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 text-center shadow-soft">
          <CheckCircle2 className="mx-auto mb-3 text-success" size={40} />
          <h1 className="font-display text-xl font-semibold">注册成功</h1>
          <p className="mt-2 text-sm text-muted">
            {done === 'confirm'
              ? '请前往邮箱查收确认邮件，完成验证后即可登录。'
              : '账号已创建，正在进入系统…'}
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            返回登录
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-soft">
        <div className="mb-6 flex flex-col items-center text-center">
          <GraduationCap className="mb-2 text-primary" size={40} />
          <h1 className="font-display text-2xl font-semibold">学生注册</h1>
          <p className="mt-1 text-sm text-muted">使用教师提供的邀请码加入班级</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>尚未配置 Supabase 环境变量，暂时无法注册。</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="姓名" error={errors.name}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="邮箱" error={errors.email}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="密码" error={errors.password} hint="至少 8 位，含字母和数字">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="确认密码" error={errors.confirm}>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="邀请码" error={errors.inviteCode}>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="如 A1B2C3D4"
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-primary"
            />
          </Field>

          {formError && (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <AlertCircle size={14} />
              {formError}
            </p>
          )}

          <Button type="submit" disabled={loading || !isSupabaseConfigured} className="w-full">
            {loading ? '注册中…' : '注册'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          已有账号？{' '}
          <Link to="/login" className="text-primary hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-danger">
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  )
}
