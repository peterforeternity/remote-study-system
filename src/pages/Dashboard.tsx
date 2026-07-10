import { useMemo } from 'react'
import { ClipboardList, FileText, CheckCircle2, Clock } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { useTeacherTasks, useStudentTasks } from '@/hooks/useTasks'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { TaskStatusBadge } from '@/components/ui/StatusBadge'
import { Link } from 'react-router-dom'

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <div className="rounded-lg bg-primary/10 p-3 text-primary">{icon}</div>
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="font-display text-2xl font-semibold">{value}</p>
        </div>
      </CardBody>
    </Card>
  )
}

export default function Dashboard() {
  const { profile } = useAuthStore()
  const isTeacher = profile?.role === 'teacher' || profile?.role === 'admin'

  const teacherTasks = useTeacherTasks()
  const studentTasks = useStudentTasks()

  const data = isTeacher ? teacherTasks.data : studentTasks.data
  const tasks = useMemo(() => data ?? [], [data])

  const publishedCount = tasks.filter((t) => t.status === 'published').length
  const draftCount = tasks.filter((t) => t.status === 'draft').length

  return (
    <div>
      <PageHeader
        title={`你好，${profile?.name ?? ''}`}
        subtitle={isTeacher ? '教师工作台概览' : '学生学习概览'}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<ClipboardList size={22} />} label="任务总数" value={tasks.length} />
        <StatCard icon={<CheckCircle2 size={22} />} label="已发布" value={publishedCount} />
        {isTeacher ? (
          <StatCard icon={<FileText size={22} />} label="草稿" value={draftCount} />
        ) : (
          <StatCard
            icon={<Clock size={22} />}
            label="待完成"
            value={publishedCount}
          />
        )}
      </div>

      <Card>
        <CardBody>
          <h2 className="mb-4 font-display text-lg font-semibold">
            {isTeacher ? '我的任务' : '已分配任务'}
          </h2>
          {(isTeacher ? teacherTasks.isLoading : studentTasks.isLoading) ? (
            <p className="text-sm text-muted">加载中…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted">暂无任务。</p>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link
                      to={`/tasks/${t.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {t.title}
                    </Link>
                    <p className="text-xs text-muted">
                      {t.subject} · 截止 {t.due_date ? new Date(t.due_date).toLocaleDateString() : '不限'}
                    </p>
                  </div>
                  <TaskStatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
