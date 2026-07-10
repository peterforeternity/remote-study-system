import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TaskStatusBadge, SubmissionStatusBadge } from '@/components/ui/StatusBadge'
import { useTask, useTaskQuestions, useTaskResources } from '@/hooks/useTasks'
import { useTaskSubmissions, useMySubmission, useCreateSubmission } from '@/hooks/useSubmissions'
import { useAuthStore } from '@/store/useAuthStore'

export default function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const isTeacher = profile?.role === 'teacher' || profile?.role === 'admin'

  const task = useTask(taskId)
  const questions = useTaskQuestions(taskId, isTeacher)
  const resources = useTaskResources(taskId)
  const submissions = useTaskSubmissions(isTeacher ? taskId : undefined)
  const mySubmission = useMySubmission(
    !isTeacher ? taskId : undefined,
    !isTeacher ? profile?.id : undefined,
  )
  const createSubmission = useCreateSubmission()

  const handleStart = async () => {
    if (!profile || !taskId) return
    const sub = await createSubmission.mutateAsync({
      taskId,
      studentId: profile.id,
      organizationId: profile.organization_id,
    })
    navigate(`/assignments/${sub.id}`)
  }

  if (task.isLoading) return <p className="text-sm text-muted">加载中…</p>
  if (!task.data) return <p className="text-sm text-muted">任务不存在或无权访问。</p>

  return (
    <div>
      <Link to={isTeacher ? '/tasks' : '/assignments'} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} /> 返回
      </Link>
      <PageHeader
        title={task.data.title}
        subtitle={`${task.data.subject} · 满分 ${task.data.full_score}`}
        action={<TaskStatusBadge status={task.data.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <h2 className="mb-2 font-display font-semibold">任务描述</h2>
              <p className="whitespace-pre-wrap text-sm text-fg">
                {task.data.description || '（无）'}
              </p>
              {task.data.due_date && (
                <p className="mt-3 text-sm text-muted">
                  截止时间：{new Date(task.data.due_date).toLocaleString()}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="mb-3 font-display font-semibold">题目</h2>
              <ol className="space-y-3">
                {(questions.data ?? []).map((q, i) => (
                  <li key={q.id} className="rounded border border-border p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                      <span>第 {i + 1} 题</span>
                      <span>· {q.type}</span>
                      <span>· {q.score} 分</span>
                    </div>
                    <p className="text-sm">{q.content}</p>
                    {isTeacher && q.answer_key && (
                      <p className="mt-1 text-xs text-success">答案：{q.answer_key}</p>
                    )}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardBody>
              <h2 className="mb-3 font-display font-semibold">相关资源</h2>
              {(resources.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">暂无资源</p>
              ) : (
                <ul className="space-y-2">
                  {(resources.data ?? []).map((r) => (
                    <li key={r.id}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                      >
                        <ExternalLink size={14} /> {r.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* 学生：开始/查看作业 */}
          {!isTeacher && (
            <Card>
              <CardBody>
                <h2 className="mb-3 font-display font-semibold">我的作业</h2>
                {mySubmission.data ? (
                  <div className="space-y-3">
                    <SubmissionStatusBadge status={mySubmission.data.status} />
                    <Button
                      className="w-full"
                      onClick={() => navigate(`/assignments/${mySubmission.data!.id}`)}
                    >
                      打开作业
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    onClick={handleStart}
                    disabled={createSubmission.isPending || task.data.status !== 'published'}
                  >
                    {task.data.status !== 'published' ? '任务未发布' : '开始作业'}
                  </Button>
                )}
              </CardBody>
            </Card>
          )}

          {/* 教师：提交记录 */}
          {isTeacher && (
            <Card>
              <CardBody>
                <h2 className="mb-3 font-display font-semibold">学生提交记录</h2>
                {submissions.isLoading ? (
                  <p className="text-sm text-muted">加载中…</p>
                ) : submissions.data?.length === 0 ? (
                  <p className="text-sm text-muted">暂无提交</p>
                ) : (
                  <ul className="space-y-2">
                    {(submissions.data ?? []).map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {s.student?.name ?? s.student_id.slice(0, 8)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <SubmissionStatusBadge status={s.status} />
                          <Link
                            to={`/grading/${s.id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            批改
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
