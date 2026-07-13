import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PenLine } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { SubmissionStatusBadge } from '@/components/ui/StatusBadge'
import { listPendingGradings } from '@/services/submissions'

export default function GradingCenter() {
  const pending = useQuery({
    queryKey: ['pending-gradings'],
    queryFn: listPendingGradings,
  })

  const items = pending.data ?? []
  // 待处理（submitted/grading/resubmitted/returned）排在已完成（graded）之前
  const active = items.filter((s) => s.status !== 'graded')
  const done = items.filter((s) => s.status === 'graded')

  return (
    <div>
      <PageHeader title="批改中心" subtitle="学生提交的作业将在此汇总，点击进入批改" />

      {pending.isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-muted">暂无学生提交的作业。</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-medium text-muted">
              待批改 · {active.length}
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted">没有待批改的作业。</p>
            ) : (
              <div className="space-y-2">
                {active.map((s) => (
                  <GradingRow key={s.id} item={s} />
                ))}
              </div>
            )}
          </section>

          {done.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted">
                已完成 · {done.length}
              </h2>
              <div className="space-y-2">
                {done.map((s) => (
                  <GradingRow key={s.id} item={s} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function GradingRow({
  item,
}: {
  item: Awaited<ReturnType<typeof listPendingGradings>>[number]
}) {
  return (
    <Link
      to={`/grading/${item.id}`}
      className="flex items-center justify-between rounded border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">
          {item.task?.title ?? '未知任务'}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {item.student?.name ?? '未知学生'}
          {item.task?.subject ? ` · ${item.task.subject}` : ''} ·{' '}
          {new Date(item.updated_at).toLocaleString()}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <SubmissionStatusBadge status={item.status} />
        <PenLine size={16} className="text-muted" />
      </div>
    </Link>
  )
}
