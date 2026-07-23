import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Eye, File, FileText, Image, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SubmissionStatusBadge } from '@/components/ui/StatusBadge'
import { useSubmission, useSubmissionFiles } from '@/hooks/useSubmissions'
import { useTask } from '@/hooks/useTasks'
import { useSubmissionRealtime } from '@/hooks/useRealtime'
import { useAuthStore } from '@/store/useAuthStore'
import { listSubmissionEvents } from '@/services/antiCheat'
import type { SubmissionEventType, SubmissionFile } from '@/types'
import {
  getOrCreateGrading,
  saveGradingDraft,
  finalizeGrading,
  returnGrading,
  getLatestFinalizedVersion,
} from '@/services/grading'
import type { GradingSession } from '@/types'
import { createSignedFileUrl, isImageFile, isPdfFile, formatFileSize } from '@/services/submissions'

const EVENT_LABELS: Record<SubmissionEventType, string> = {
  blur: '窗口失焦/切屏',
  visibility_hidden: '切换标签页',
  paste_blocked: '尝试粘贴（已拦截）',
  copy_blocked: '尝试复制（已拦截）',
  fullscreen_exit: '退出全屏',
  auto_submit_timeout: '超时自动提交',
}

function FileIcon({ file }: { file: SubmissionFile }) {
  if (file.mime_type.startsWith('image/')) return <Image size={14} />
  if (file.mime_type === 'application/pdf') return <FileText size={14} />
  return <File size={14} />
}

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

  // 文件相关状态
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [previewFile, setPreviewFile] = useState<SubmissionFile | null>(null)
  const [loadingUrls, setLoadingUrls] = useState<Set<string>>(new Set())

  const version = useQuery({
    queryKey: ['grading-version', submissionId],
    queryFn: () => getLatestFinalizedVersion(submissionId!),
    enabled: Boolean(submissionId),
  })

  // 获取当前版本的文件列表
  const files = useSubmissionFiles(version.data?.id)

  const events = useQuery({
    queryKey: ['submission-events', submissionId],
    queryFn: () => listSubmissionEvents(submissionId!),
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

  // ========== 文件操作 ==========

  const handleGetSignedUrl = async (f: SubmissionFile) => {
    if (signedUrls[f.id]) return signedUrls[f.id]
    setLoadingUrls((prev) => new Set(prev).add(f.id))
    try {
      const url = await createSignedFileUrl(f.object_key, 300)
      setSignedUrls((prev) => ({ ...prev, [f.id]: url }))
      return url
    } catch {
      setMsg('无法生成下载链接')
      return null
    } finally {
      setLoadingUrls((prev) => {
        const next = new Set(prev)
        next.delete(f.id)
        return next
      })
    }
  }

  const handlePreview = async (f: SubmissionFile) => {
    const url = await handleGetSignedUrl(f)
    if (url) setPreviewFile(f)
  }

  const handleDownload = async (f: SubmissionFile) => {
    const url = await handleGetSignedUrl(f)
    if (url) window.open(url, '_blank')
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

                {/* 学生上传的文件 */}
                {files.data && files.data.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <h3 className="mb-2 text-sm font-medium">提交文件</h3>
                    <ul className="space-y-1">
                      {files.data.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between rounded border border-border p-2 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileIcon file={f} />
                            <span className="truncate">{f.file_name}</span>
                            <span className="text-xs text-muted shrink-0">
                              {formatFileSize(f.file_size)}
                            </span>
                            {f.scan_status === 'pending' && (
                              <span className="text-xs text-warning shrink-0">病毒扫描中</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            {(isImageFile(f) || isPdfFile(f)) && (
                              <Button
                                type="button"
                                variant="ghost"
                               
                                onClick={() => handlePreview(f)}
                                disabled={loadingUrls.has(f.id)}
                                title="预览"
                              >
                                <Eye size={14} />
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                             
                              onClick={() => handleDownload(f)}
                              disabled={loadingUrls.has(f.id)}
                              title="下载"
                            >
                              <Download size={14} />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">学生尚未正式提交。</p>
            )}
          </CardBody>
        </Card>

        {/* 监考行为记录 */}
        <Card>
          <CardBody>
            <h2 className="mb-2 font-display font-semibold">监考行为记录</h2>
            {events.isLoading ? (
              <p className="text-sm text-muted">加载中…</p>
            ) : (events.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-success">未检测到异常行为。</p>
            ) : (
              <div>
                <p className="mb-2 text-sm text-danger">
                  共 {events.data!.length} 条异常行为记录
                </p>
                <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                  {events.data!.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between rounded border border-border px-2 py-1"
                    >
                      <span>{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
                      <span className="text-xs text-muted">
                        {new Date(ev.created_at).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
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

      {/* 文件预览弹窗 */}
      {previewFile && signedUrls[previewFile.id] && (
        <div className="mt-4">
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm">{previewFile.file_name}</h3>
                <Button type="button" variant="ghost" onClick={() => setPreviewFile(null)}>
                  <X size={14} />
                </Button>
              </div>
              {isImageFile(previewFile) ? (
                <img
                  src={signedUrls[previewFile.id]}
                  alt={previewFile.file_name}
                  className="max-h-96 rounded border border-border object-contain"
                />
              ) : isPdfFile(previewFile) ? (
                <iframe
                  src={signedUrls[previewFile.id]}
                  title={previewFile.file_name}
                  className="h-[600px] w-full rounded border border-border"
                />
              ) : null}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
