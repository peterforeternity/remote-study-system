import { Check, Palette } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { InviteCodesCard } from '@/components/InviteCodesCard'
import { useThemeStore, THEMES } from '@/store/useThemeStore'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/lib/utils'

export default function Settings() {
  const { theme, setTheme } = useThemeStore()
  const { profile } = useAuthStore()
  const canManageInvites = profile?.role === 'teacher' || profile?.role === 'admin'

  return (
    <div>
      <PageHeader title="设置" subtitle="主题外观与个人信息" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h2 className="mb-4 flex items-center gap-2 font-display font-semibold">
              <Palette size={18} /> 界面主题
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  data-theme={t.id}
                  className={cn(
                    'relative rounded-lg border-2 p-3 text-left transition-all',
                    theme === t.id ? 'border-primary' : 'border-border',
                  )}
                >
                  <div className="mb-2 flex gap-1">
                    <span className="h-5 w-5 rounded-full bg-primary" />
                    <span className="h-5 w-5 rounded-full bg-accent" />
                    <span className="h-5 w-5 rounded-full bg-surface border border-border" />
                  </div>
                  <span className="text-xs font-medium text-fg">{t.name}</span>
                  {theme === t.id && (
                    <Check size={14} className="absolute right-2 top-2 text-primary" />
                  )}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              主题偏好保存在本地（localStorage），切换不影响任何业务数据。
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="mb-4 font-display font-semibold">个人信息</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">姓名</dt>
                <dd>{profile?.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">邮箱</dt>
                <dd>{profile?.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">角色</dt>
                <dd>
                  {profile?.role === 'teacher'
                    ? '教师'
                    : profile?.role === 'admin'
                      ? '管理员'
                      : '学生'}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>

      {canManageInvites && (
        <div className="mt-6">
          <InviteCodesCard />
        </div>
      )}
    </div>
  )
}
