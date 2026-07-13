import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Save, Send, ShieldAlert, Maximize, Timer } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SubmissionStatusBadge } from '@/components/ui/StatusBadge'
import { DictationPanel, type DictationAnswer } from '@/components/DictationPanel'
import {
  useSubmission,
  useSubmissionVersions,
  useFinalizeSubmission,
  useSaveDraft,
} from '@/hooks/useSubmissions'
import { useSubmissionRealtime } from '@/hooks/useRealtime'
import { useTask, useTaskQuestions } from '@/hooks/useTasks'
import { useAntiCheat } from '@/hooks/useAntiCheat'
import { useAuthStore } from '@/store/useAuthStore'

export default function AssignmentDetail() {
  const { submissionId } = useParams<{ submissionId: string }>()
  const { profile } = useAuthStore()
  const submission = useSubmission(submissionId)
  const versions = useSubmissionVersions(submissionId)
  const task = useTask(submission.data?.task_id)
  const questions = useTaskQuestions(submission.data?.task_id, false)
  const finalize = useFinalizeSubmission()
  const saveDraft = useSaveDraft()
  const [text, setText] = useState('')
  const [dictation, setDictation] = useState<DictationAnswer[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoSubmittedRef = useRef(false)

  useSubmissionRealtime(submissionId)

  const dictationQuestions = useMemo(
    () => (questions.data ?? []).filter((q) => q.type === 'dictation'),
    [questions.data],
  )
  const hasDictation = dictationQuestions.length > 0

  const isFinalized =
    submission.data?.status === 'submitted' ||
    submission.data?.status === 'graded' ||
    submission.data?.status === 'grading' ||
    submission.data?.status === 'resubmitted'

  // 防作弊监控：仅在答题（未定稿）时开启
  const antiCheat = useAntiCheat({
    enabled: !isFinalized && Boolean(submission.data),
    submissionId: submission.data?.id,
    studentId: profile?.id,
    organizationId: submission.data?.organization_id,
    containerRef,
  })

  // 载入最新版本作答内容
  useEffect(() => {
    if (versions.data && versions.data.length > 0) {
      setText(versions.data[0].text_answer ?? '')
    }
  }, [versions.data])

  // 组合最终提交文本：正文 + 听写作答汇总
  const composeAnswer = () => {
    if (!hasDictation) return text
    const lines = dictation.map(
      (d, i) => `听写${i + 1}: ${d.answer || '(未作答)'} [${d.correct ? '✓' : '✗'}]`,
    )
    const correctCount = dictation.filter((d) => d.correct).length
    return [
      text.trim(),
      '',
      `--- 听写作答（${correctCount}/${dictationQuestions.length} 正确）---`,
      ...lines,
    ]
      .filter((l) => l !== undefined)
      .join('\n')
  }

  const handleSaveDraft = async () => {
    if (!submission.data || !profile) return
    setMsg(null)
    await saveDraft.mutateAsync({
      submission: submission.data,
      createdBy: profile.id,
      textAnswer: composeAnswer(),
    })
    setMsg('草稿已保存')
  }

  const handleFinalize = async () => {
    if (!submission.data || !profile) return
    setMsg(null)
    await finalize.mutateAsync({
      submission: submission.data,
      createdBy: profile.id,
      textAnswer: composeAnswer(),
    })
    setMsg('已正式提交')
  }

  // 倒计时：任务有截止时间且未定稿时启动，超时自动提交一次
  const dueTs = task.data?.due_date ? new Date(task.data.due_date).getTime() : null
  useEffect(() => {
    if (isFinalized || !dueTs) {
      setRemainingMs(null)
      return
    }
    const tick = () => {
      const left = dueTs - Date.now()
      setRemainingMs(left)
      if (left <= 0 && !autoSubmittedRef.current && submission.data && profile) {
        autoSubmittedRef.current = true
        void finalize.mutateAsync({
          submission: submission.data,
          createdBy: profile.id,
          textAnswer: composeAnswer(),
        })
        setMsg('已到截止时间，系统已自动提交')
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueTs, isFinalized, submission.data?.id, profile?.id])

  const fmtRemaining = (ms: number) => {
    if (ms <= 0) return '已截止'
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h > 0 ? `${h}时` : ''}${m}分${sec}秒`
  }

  if (submission.isLoading) return <p className="text-sm text-muted">加载中…</p>
  if (!submission.data) return <p className="text-sm text-muted">作业不存在或无权访问。</p>

  const canSubmit = hasDictation
    ? dictation.some((d) => d.answer.trim())
    : Boolean(text.trim())

  return (
    <div ref={containerRef}>
      <Link to="/assignments" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} /> 返回作业列表
      </Link>
      <PageHeader
        title={task.data?.title ?? '作业'}
        subtitle={task.data?.subject}
        action={<SubmissionStatusBadge status={submission.data.status} />}
      />

      {/* 防作弊提示条 */}
      {!isFinalized && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-border bg-surface px-4 py-2 text-sm">
          <ShieldAlert size={16} className="text-primary" />
          <span className="text-muted">
            答题过程受监考保护：切屏、复制粘贴等行为将被记录。
          </span>
          {antiCheat.violations > 0 && (
            <span className="font-medium text-danger">
              已检测到 {antiCheat.violations} 次异常行为
            </span>
          )}
          {remainingMs != null && (
            <span
              className={
                remainingMs <= 60000 ? 'flex items-center gap-1 font-medium text-danger' : 'flex items-center gap-1 text-muted'
              }
            >
              <Timer size={14} /> 剩余 {fmtRemaining(remainingMs)}
            </span>
          )}
          {!antiCheat.isFullscreen && (
            <Button
              type="button"
              variant="ghost"
              onClick={antiCheat.requestFullscreen}
              className="ml-auto"
            >
              <Maximize size={16} /> 进入全屏专注模式
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {hasDictation && (
            <Card>
              <CardBody>
                <h2 className="mb-3 font-display font-semibold">听写作答</h2>
                <DictationPanel
                  questions={dictationQuestions}
                  disabled={isFinalized}
                  onChange={setDictation}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <h2 className="mb-2 font-display font-semibold">
                {hasDictation ? '文字作答（可选）' : '作答区'}
              </h2>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={hasDictation ? 6 : 12}
                disabled={isFinalized}
                placeholder="在此填写你的作答内容…"
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-70"
              />
              {msg && <p className="mt-2 text-sm text-success">{msg}</p>}
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={handleSaveDraft} disabled={isFinalized || saveDraft.isPending}>
                  <Save size={16} /> 保存草稿
                </Button>
                <Button onClick={handleFinalize} disabled={finalize.isPending || !canSubmit}>
                  <Send size={16} /> {isFinalized ? '重新提交' : '正式提交'}
                </Button>
              </div>
              {isFinalized && (
                <p className="mt-2 text-xs text-muted">
                  已正式提交。如需修改可重新提交，将生成新版本，旧版本保留不可覆盖。
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardBody>
              <h2 className="mb-3 font-display font-semibold">版本历史</h2>
              {versions.data?.length === 0 ? (
                <p className="text-sm text-muted">暂无版本</p>
              ) : (
                <ul className="space-y-2">
                  {(versions.data ?? []).map((v) => (
                    <li key={v.id} className="rounded border border-border p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">v{v.version_no}</span>
                        <span className="text-xs text-muted">
                          {v.finalized ? '已提交' : '草稿'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {new Date(v.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
