import { cn } from '@/lib/utils'
import type { SubmissionStatus, TaskStatus } from '@/types'

const SUBMISSION_LABELS: Record<SubmissionStatus, { text: string; cls: string }> = {
  draft: { text: '草稿', cls: 'bg-muted/20 text-muted' },
  uploading: { text: '上传中', cls: 'bg-accent/20 text-accent' },
  submitted: { text: '已提交', cls: 'bg-primary/15 text-primary' },
  ai_processing: { text: 'AI处理中', cls: 'bg-accent/20 text-accent' },
  grading: { text: '批改中', cls: 'bg-warning/20 text-warning' },
  graded: { text: '已批改', cls: 'bg-success/20 text-success' },
  returned: { text: '已退回', cls: 'bg-danger/15 text-danger' },
  resubmitted: { text: '重新提交', cls: 'bg-primary/15 text-primary' },
}

const TASK_LABELS: Record<TaskStatus, { text: string; cls: string }> = {
  draft: { text: '草稿', cls: 'bg-muted/20 text-muted' },
  published: { text: '已发布', cls: 'bg-success/20 text-success' },
  closed: { text: '已关闭', cls: 'bg-warning/20 text-warning' },
  archived: { text: '已归档', cls: 'bg-muted/20 text-muted' },
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const s = SUBMISSION_LABELS[status]
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', s.cls)}>
      {s.text}
    </span>
  )
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_LABELS[status]
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', s.cls)}>
      {s.text}
    </span>
  )
}
