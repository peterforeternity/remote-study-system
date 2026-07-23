import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Save, Send, ShieldAlert, Maximize, Timer,
  Upload, X, FileText, Image, File, Trash2, Download, Eye,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SubmissionStatusBadge } from '@/components/ui/StatusBadge'
import { DictationPanel, type DictationAnswer } from '@/components/DictationPanel'
import {
  useSubmission,
  useSubmissionVersions,
  useSubmissionFiles,
  useFinalizeSubmission,
  useSaveDraft,
  useCreateDraftVersion,
  useUploadSubmissionFile,
  useDeleteSubmissionFile,
} from '@/hooks/useSubmissions'
import { useSubmissionRealtime } from '@/hooks/useRealtime'
import { useTask, useTaskQuestions } from '@/hooks/useTasks'
import { useAntiCheat } from '@/hooks/useAntiCheat'
import { useAuthStore } from '@/store/useAuthStore'
import {
  computeSHA256,
  createSignedFileUrl,
  isImageFile,
  isPdfFile,
  formatFileSize,
  type SubmissionFile,
} from '@/services/submissions'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_MIME_PREFIXES = [
  'image/', 'application/pdf', 'text/',
  'application/msword', 'application/vnd.openxmlformats-officedocument.',
  'application/vnd.ms-', 'application/zip', 'application/x-7z-compressed',
]

function isAllowedMime(mime: string): boolean {
  if (!mime) return false
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))
}

interface UploadingFile {
  file: File
  sha256: string | null
  progress: number
  error: string | null
  status: 'pending' | 'hashing' | 'uploading' | 'done' | 'error'
  id: string
}

export default function AssignmentDetail() {
  const { submissionId } = useParams<{ submissionId: string }>()
  const { profile } = useAuthStore()
  const submission = useSubmission(submissionId)
  const versions = useSubmissionVersions(submissionId)
  const task = useTask(submission.data?.task_id)
  const questions = useTaskQuestions(submission.data?.task_id, false)
  const finalize = useFinalizeSubmission()
  const saveDraft = useSaveDraft()
  const createDraftVer = useCreateDraftVersion()
  const uploadFile = useUploadSubmissionFile()
  const deleteFile = useDeleteSubmissionFile()

  // 自动创建 draft version（无版本时，文件上传需要 versionId）
  const autoCreatedRef = useRef(false)
  useEffect(() => {
    if (
      !autoCreatedRef.current &&
      submission.data?.status === 'draft' &&
      versions.data &&
      versions.data.length === 0 &&
      profile
    ) {
      autoCreatedRef.current = true
      createDraftVer.mutateAsync({
        submissionId: submission.data.id,
        createdBy: profile.id,
      }).catch((err) => {
        console.error('[auto-create-draft] 创建版本失败:', err)
        autoCreatedRef.current = false // 允许重试
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission.data?.status, versions.data, profile, createDraftVer])

  const [text, setText] = useState('')
  const [dictation, setDictation] = useState<DictationAnswer[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoSubmittedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 文件上传状态
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [dragOver, setDragOver] = useState(false)

  // 当前查看的版本 ID（默认当前版本）
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const currentVersionId = selectedVersionId || versions.data?.[0]?.id || null
  const files = useSubmissionFiles(currentVersionId ?? undefined)

  // 签名 URL 缓存（短期）
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [previewFile, setPreviewFile] = useState<SubmissionFile | null>(null)

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
    if (versions.data && versions.data.length > 0 && !selectedVersionId) {
      setText(versions.data[0].text_answer ?? '')
    }
  }, [versions.data, selectedVersionId])

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

  // ========== 文件上传 ==========

  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      if (!submission.data || !profile) return
      const files = Array.from(fileList)

      for (const file of files) {
        // 校验
        if (file.size > MAX_FILE_SIZE) {
          setUploadingFiles((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              file,
              sha256: null,
              progress: 0,
              error: `文件超过 ${formatFileSize(MAX_FILE_SIZE)} 限制`,
              status: 'error',
            },
          ])
          continue
        }
        if (!isAllowedMime(file.type)) {
          setUploadingFiles((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              file,
              sha256: null,
              progress: 0,
              error: `不支持的文件类型: ${file.type || '未知'}`,
              status: 'error',
            },
          ])
          continue
        }

        const uid = crypto.randomUUID()
        setUploadingFiles((prev) => [
          ...prev,
          { id: uid, file, sha256: null, progress: 0, error: null, status: 'hashing' },
        ])

        // 计算 SHA-256（不阻塞 UI）
        computeSHA256(file).then((hash) => {
          setUploadingFiles((prev) =>
            prev.map((f) => (f.id === uid ? { ...f, sha256: hash, status: 'uploading' } : f)),
          )
        })

        // 上传
        try {
          await uploadFile.mutateAsync({
            submissionId: submission.data.id,
            versionId: currentVersionId!,
            organizationId: submission.data.organization_id,
            studentId: profile.id,
            file,
          })
          setUploadingFiles((prev) =>
            prev.map((f) => (f.id === uid ? { ...f, progress: 100, status: 'done' } : f)),
          )
        } catch (e) {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === uid
                ? { ...f, error: e instanceof Error ? e.message : 'Upload failed', status: 'error' }
                : f,
            ),
          )
        }
      }
    },
    [submission.data, profile, currentVersionId, uploadFile],
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }
  const handleDragLeave = () => setDragOver(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (isFinalized) return
    handleFilesSelected(e.dataTransfer.files)
  }

  const removeFromUploadList = (uid: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== uid))
  }

  const handleDeleteFile = async (f: SubmissionFile) => {
    if (!confirm(`确认删除文件 "${f.file_name}"？`)) return
    try {
      await deleteFile.mutateAsync(f)
    } catch {
      setMsg('删除失败')
    }
  }

  const handlePreviewFile = async (f: SubmissionFile) => {
    if (signedUrls[f.id]) {
      setPreviewFile(f)
      return
    }
    try {
      const url = await createSignedFileUrl(f.object_key)
      setSignedUrls((prev) => ({ ...prev, [f.id]: url }))
      setPreviewFile(f)
    } catch {
      setMsg('无法生成预览链接')
    }
  }

  // ========== 版本切换 ==========

  const handleVersionSelect = (versionId: string) => {
    setSelectedVersionId(versionId)
    setPreviewFile(null)
    setSignedUrls({})
  }

  // 倒计时
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

  const getFileIcon = (f: SubmissionFile | UploadingFile) => {
    const mime = 'mime_type' in f ? f.mime_type : f.file.type
    if (mime.startsWith('image/')) return <Image size={14} />
    if (mime === 'application/pdf') return <FileText size={14} />
    return <File size={14} />
  }

  if (submission.isLoading) return <p className="text-sm text-muted">加载中…</p>
  if (!submission.data) return <p className="text-sm text-muted">作业不存在或无权访问。</p>

  const canSubmit = hasDictation
    ? dictation.some((d) => d.answer.trim())
    : Boolean(text.trim()) || (files.data && files.data.length > 0)

  // 当前选中的版本
  const selectedVersion = versions.data?.find((v) => v.id === currentVersionId)
  const isSelectedFinalized = selectedVersion?.finalized ?? false

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

          {/* ======== 文件上传区域 ======== */}
          <Card>
            <CardBody>
              <h2 className="mb-2 font-display font-semibold">附加文件</h2>
              {isSelectedFinalized ? (
                <p className="mb-2 text-xs text-muted">
                  此版本已正式提交，文件不可修改。
                </p>
              ) : (
                <p className="mb-2 text-xs text-muted">
                  支持图片、PDF、文档、压缩包（单文件 ≤ 50MB）。提交后文件不可修改。
                </p>
              )}

              {/* 拖拽上传区域 */}
              {!isSelectedFinalized && (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`mb-3 cursor-pointer rounded border-2 border-dashed p-4 text-center transition-colors ${
                    dragOver
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <Upload size={20} className="mx-auto mb-1 text-muted" />
                  <p className="text-sm text-muted">
                    拖拽文件到此处或点击选择文件
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
                  />
                </div>
              )}

              {/* 已上传文件列表 */}
              {files.isLoading && <p className="text-xs text-muted">加载文件列表…</p>}
              {files.data && files.data.length > 0 && (
                <ul className="space-y-1.5">
                  {files.data.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between rounded border border-border p-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {getFileIcon(f)}
                        <span className="truncate">{f.file_name}</span>
                        <span className="text-xs text-muted shrink-0">{formatFileSize(f.file_size)}</span>
                        {f.sha256 && (
                          <span className="text-xs text-muted font-mono shrink-0 hidden sm:inline">
                            SHA256: {f.sha256.substring(0, 8)}…
                          </span>
                        )}
                        {f.scan_status === 'pending' && (
                          <span className="text-xs text-warning shrink-0">病毒扫描中</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {(isImageFile(f) || isPdfFile(f)) && (
                          <Button
                            type="button"
                            variant="ghost"
                           
                            onClick={() => handlePreviewFile(f)}
                            title="预览"
                          >
                            <Eye size={14} />
                          </Button>
                        )}
                        <a
                          href={signedUrls[f.id] || '#'}
                          onClick={async (e) => {
                            if (!signedUrls[f.id]) {
                              e.preventDefault()
                              try {
                                const url = await createSignedFileUrl(f.object_key)
                                setSignedUrls((prev) => ({ ...prev, [f.id]: url }))
                                window.open(url, '_blank')
                              } catch {
                                setMsg('无法生成下载链接')
                              }
                            }
                          }}
                          className="inline-flex items-center text-muted hover:text-fg"
                          title="下载"
                        >
                          <Download size={14} />
                        </a>
                        {!isSelectedFinalized && (
                          <Button
                            type="button"
                            variant="ghost"
                           
                            onClick={() => handleDeleteFile(f)}
                            title="删除"
                            className="text-danger hover:text-danger"
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {(!files.data || files.data.length === 0) && (
                <p className="text-xs text-muted">尚未上传任何文件。</p>
              )}

              {/* 上传中列表 */}
              {uploadingFiles.filter((f) => f.status !== 'done').length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border pt-2">
                  {uploadingFiles
                    .filter((f) => f.status !== 'done')
                    .map((uf) => (
                      <li
                        key={uf.id}
                        className="flex items-center justify-between rounded border border-border p-1.5 text-xs"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {getFileIcon(uf)}
                          <span className="truncate">{uf.file.name}</span>
                          {uf.sha256 && (
                            <span className="text-muted font-mono hidden sm:inline">
                              SHA256: {uf.sha256.substring(0, 8)}…
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {uf.status === 'hashing' && <span className="text-muted">计算哈希…</span>}
                          {uf.status === 'uploading' && <span className="text-muted">上传中…</span>}
                          {uf.status === 'error' && (
                            <span className="text-danger">{uf.error}</span>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                           
                            onClick={() => removeFromUploadList(uf.id)}
                          >
                            <X size={12} />
                          </Button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* 文件预览 */}
          {previewFile && signedUrls[previewFile.id] && (
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
                    className="max-h-80 rounded border border-border object-contain"
                  />
                ) : isPdfFile(previewFile) ? (
                  <iframe
                    src={signedUrls[previewFile.id]}
                    title={previewFile.file_name}
                    className="h-96 w-full rounded border border-border"
                  />
                ) : (
                  <p className="text-sm text-muted">此文件类型暂不支持预览，请下载后查看。</p>
                )}
              </CardBody>
            </Card>
          )}
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
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => handleVersionSelect(v.id)}
                        className={`w-full rounded border p-2 text-left text-sm transition-colors ${
                          currentVersionId === v.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">v{v.version_no}</span>
                          <span className={`text-xs ${v.finalized ? 'text-success' : 'text-warning'}`}>
                            {v.finalized ? '已提交' : '草稿'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {new Date(v.created_at).toLocaleString()}
                        </p>
                        {v.finalized_at && v.finalized && (
                          <p className="text-xs text-muted">
                            提交于 {new Date(v.finalized_at).toLocaleString()}
                          </p>
                        )}
                      </button>
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
