import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { TaskStatusBadge } from '@/components/ui/StatusBadge'
import { useStudentTasks } from '@/hooks/useTasks'

export default function Assignments() {
  const tasks = useStudentTasks()

  return (
    <div>
      <PageHeader title="我的作业" subtitle="查看已分配任务并提交作业" />

      <Card>
        <CardBody>
          {tasks.isLoading ? (
            <p className="text-sm text-muted">加载中…</p>
          ) : tasks.data?.length === 0 ? (
            <p className="text-sm text-muted">暂无已分配任务。</p>
          ) : (
            <ul className="divide-y divide-border">
              {(tasks.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link to={`/tasks/${t.id}`} className="font-medium hover:text-primary">
                      {t.title}
                    </Link>
                    <p className="text-xs text-muted">
                      {t.subject} · 截止{' '}
                      {t.due_date ? new Date(t.due_date).toLocaleDateString() : '不限'}
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
