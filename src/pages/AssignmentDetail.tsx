import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Save, Send } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SubmissionStatusBadge } from '@/components/ui/StatusBadge'
import {
  useSubmission,
  useSubmissionVersions,
  useFinalizeSubmission,
  useSaveDraft,
} from '@/hooks/useSubmissions'
import { useSubmissionRealtime } from '@/hooks/useRealtime'
import { useTask } from '@/hooks/useTasks'
import { useAuthStore } from '@/store/useAuthStore'

export default function AssignmentDetail() {
  const { submissionId } = useParams<{ submissionId: string }>()
  const { profile } = useAuthStore()
  const submission = useSubmission(submissionId)
  const versions = useSubmissionVersions(submissionId)
  const task = useTask(submission.data?.task_id)
  const finalize = useFinalizeSubmission()
  const saveDraft = useSaveDraft()
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useSubmissionRealtime(submissionId)

  // 载入最新版本作答内容
  useEffect(() => {
    if (versions.data && versions.data.length > 0) {
      setText(versions.data[0].text_answer ?? '')
    }
  }, [versions.data])

  const isFinalized =
    submission.data?.status === 'submitted' ||
    submission.data?.status === 'graded' ||
    submission.data?.status === 'grading' ||
    submission.data?.status === 'resubmitted'

  const handleSaveDraft = async () => {
    if (!submission.data || !profile) return
    setMsg(null)
    await saveDraft.mutateAsync({
      submission: submission.data,
      createdBy: profile.id,
      textAnswer: text,
    })
    setMsg('草稿已保存')
  }

  const handleFinalize = async () => {
    if (!submission.data || !profile) return
    setMsg(null)
    await finalize.mutateAsync({
      submission: submission.data,
      createdBy: profile.id,
      textAnswer: text,
    })
    setMsg('已正式提交')
  }

  if (submission.isLoading) return <p className="text-sm text-muted">加载中…</p>
  if (!submission.data) return <p className="text-sm text-muted">作业不存在或无权访问。</p>

  return (
    <div>
      <Link to="/assignments" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} /> 返回作业列表
      </Link>
      <PageHeader
        title={task.data?.title ?? '作业'}
        subtitle={task.data?.subject}
        action={<SubmissionStatusBadge status={submission.data.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardBody>
              <h2 className="mb-2 font-display font-semibold">作答区</h2>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                disabled={isFinalized}
                placeholder="在此填写你的作答内容…"
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-70"
              />
              {msg && <p className="mt-2 text-sm text-success">{msg}</p>}
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={handleSaveDraft} disabled={isFinalized || saveDraft.isPending}>
                  <Save size={16} /> 保存草稿
                </Button>
                <Button onClick={handleFinalize} disabled={finalize.isPending || !text.trim()}>
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
