import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SubmissionStatusBadge } from '@/components/ui/StatusBadge'
import { useSubmission } from '@/hooks/useSubmissions'
import { useTask } from '@/hooks/useTasks'
import { useSubmissionRealtime } from '@/hooks/useRealtime'
import { useAuthStore } from '@/store/useAuthStore'
import {
  getOrCreateGrading,
  saveGradingDraft,
  finalizeGrading,
  returnGrading,
  getLatestFinalizedVersion,
} from '@/services/grading'
import type { GradingSession } from '@/types'

export default function Grading() {
  const { submissionId } = useParams<{ submissionId: string }>()
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const submission = useSubmission(submissionId)
  const task = useTask(submission.data?.task_id)
  useSubmissionRealtime(submissionId)

  const [grading, setGrading] = useState<GradingSession | null>(null)
  const [score, setScore] = useState<string>('')
  const [comment, setComment] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const version = useQuery({
    queryKey: ['grading-version', submissionId],
    queryFn: () => getLatestFinalizedVersion(submissionId!),
    enabled: Boolean(submissionId),
  })

  // 打开时创建/获取批改会话
  useEffect(() => {
    const run = async () => {
      if (!submission.data || !profile) return
      try {
        const g = await getOrCreateGrading({
          submissionId: submission.data.id,
          organizationId: submission.data.organization_id,
          graderId: profile.id,
        })
        setGrading(g)
        setScore(g.score != null ? String(g.score) : '')
        setComment(g.comment ?? '')
        qc.invalidateQueries({ queryKey: ['submission', submissionId] })
      } catch (e) {
        setError(e instanceof Error ? e.message : '无法开启批改')
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission.data?.id, profile?.id])

  const handleSave = async () => {
    if (!grading) return
    setError(null)
    setMsg(null)
    try {
      const updated = await saveGradingDraft({
        grading,
        score: score === '' ? null : Number(score),
        comment,
      })
      setGrading(updated)
      setMsg('批改草稿已保存')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  const handleFinalize = async () => {
    if (!grading || !submission.data || !task.data) return
    setError(null)
    setMsg(null)
    try {
      const updated = await saveGradingDraft({
        grading,
        score: score === '' ? null : Number(score),
        comment,
      })
      await finalizeGrading({
        grading: updated,
        submissionId: submission.data.id,
        studentId: submission.data.student_id,
        organizationId: submission.data.organization_id,
        taskTitle: task.data.title,
      })
      setMsg('已发布批改结果，学生将实时收到通知')
      qc.invalidateQueries({ queryKey: ['submission', submissionId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : '发布失败')
    }
  }

  const handleReturn = async () => {
    if (!grading || !submission.data || !task.data) return
    try {
      await returnGrading({
        gradingId: grading.id,
        submissionId: submission.data.id,
        studentId: submission.data.student_id,
        organizationId: submission.data.organization_id,
        taskTitle: task.data.title,
      })
      setMsg('已退回学生修改')
      qc.invalidateQueries({ queryKey: ['submission', submissionId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : '退回失败')
    }
  }

  if (submission.isLoading) return <p className="text-sm text-muted">加载中…</p>
  if (!submission.data) return <p className="text-sm text-muted">作业不存在或无权访问。</p>

  return (
    <div>
      <Link
        to={`/tasks/${submission.data.task_id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft size={16} /> 返回任务
      </Link>
      <PageHeader
        title="在线批改"
        subtitle={task.data?.title}
        action={<SubmissionStatusBadge status={submission.data.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左：学生作答 */}
        <Card>
          <CardBody>
            <h2 className="mb-2 font-display font-semibold">学生作答</h2>
            {version.isLoading ? (
              <p className="text-sm text-muted">加载中…</p>
            ) : version.data ? (
              <div>
                <p className="mb-2 text-xs text-muted">
                  版本 v{version.data.version_no} ·{' '}
                  {version.data.finalized_at
                    ? new Date(version.data.finalized_at).toLocaleString()
                    : ''}
                </p>
                <div className="whitespace-pre-wrap rounded border border-border bg-bg p-3 text-sm">
                  {version.data.text_answer || '（无文本作答）'}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">学生尚未正式提交。</p>
            )}
          </CardBody>
        </Card>

        {/* 右：批改 */}
        <Card>
          <CardBody>
            <h2 className="mb-3 font-display font-semibold">评分与评语</h2>
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium">
                总分（满分 {task.data?.full_score ?? 100}）
              </label>
              <input
                type="number"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="w-32 rounded border border-border bg-bg px-3 py-2 text-sm"
              />
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium">总体评语</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={5}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm"
              />
            </div>

            {msg && <p className="mb-2 text-sm text-success">{msg}</p>}
            {error && <p className="mb-2 text-sm text-danger">{error}</p>}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleSave} disabled={!grading}>
                保存草稿
              </Button>
              <Button onClick={handleFinalize} disabled={!grading}>
                发布成绩
              </Button>
              <Button variant="ghost" onClick={handleReturn} disabled={!grading}>
                退回修改
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
