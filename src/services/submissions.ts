import { supabase } from '@/lib/supabase'
import type { Submission, SubmissionVersion, Profile, SubmissionFile } from '@/types'

// Re-export for convenience
export type { SubmissionFile }

// ============================================================
// 作业服务：创建作业、创建版本、正式提交、文件上传。
// 优先使用受控 RPC；RPC 不可用时回退到直接 DB 操作（向后兼容迁移前）。
// ============================================================

export interface SubmissionWithStudent extends Submission {
  student?: Pick<Profile, 'id' | 'name' | 'email'>
}

// ---- 对象路径工具 ----
export function buildObjectPath(params: {
  organizationId: string
  studentId: string
  submissionId: string
  versionId: string
  fileName: string
}): string {
  const { organizationId, studentId, submissionId, versionId, fileName } = params
  const uuid = crypto.randomUUID()
  return `${organizationId}/students/${studentId}/submissions/${submissionId}/versions/${versionId}/${uuid}-${encodeURIComponent(fileName)}`
}

// ---- SHA-256 计算（浏览器端） ----
export async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================
// Submission 查询
// ============================================================

/** 按 id 获取作业。 */
export async function getSubmissionById(
  submissionId: string,
): Promise<Submission | null> {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle()
  if (error) throw error
  return (data as Submission) ?? null
}

/** 学生获取（或惰性了解）本人对某任务的作业。 */
export async function getMySubmission(
  taskId: string,
  studentId: string,
): Promise<Submission | null> {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('task_id', taskId)
    .eq('student_id', studentId)
    .maybeSingle()
  if (error) throw error
  return (data as Submission) ?? null
}

/** 教师查看某任务下的全部提交记录（含学生信息）。 */
export async function listTaskSubmissions(
  taskId: string,
): Promise<SubmissionWithStudent[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select('*, student:profiles!submissions_student_id_fkey(id, name, email)')
    .eq('task_id', taskId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data as unknown as SubmissionWithStudent[]) ?? []
}

export interface PendingGrading extends SubmissionWithStudent {
  task?: { id: string; title: string; subject: string }
}

/**
 * 批改中心：列出教师名下所有待批改/批改中的提交。
 * RLS 保证只返回教师可管理任务的提交（can_manage_task）。
 */
export async function listPendingGradings(): Promise<PendingGrading[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select(
      '*, student:profiles!submissions_student_id_fkey(id, name, email), task:tasks!submissions_task_id_fkey(id, title, subject)',
    )
    .in('status', ['submitted', 'grading', 'resubmitted', 'graded', 'returned'])
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data as unknown as PendingGrading[]) ?? []
}

/** 创建作业（草稿）。 */
export async function createSubmission(params: {
  taskId: string
  studentId: string
  organizationId: string
}): Promise<Submission> {
  const { data, error } = await supabase
    .from('submissions')
    .insert({
      task_id: params.taskId,
      student_id: params.studentId,
      organization_id: params.organizationId,
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Submission
}

export async function listVersions(
  submissionId: string,
): Promise<SubmissionVersion[]> {
  const { data, error } = await supabase
    .from('submission_versions')
    .select('*')
    .eq('submission_id', submissionId)
    .order('version_no', { ascending: false })
  if (error) throw error
  return (data as SubmissionVersion[]) ?? []
}

// ============================================================
// RPC 封装（优先使用受控 RPC，不可用时回退直接 DB 操作）
// ============================================================

/**
 * 创建/获取草稿版本（优先 RPC）。
 * 并发安全：两次调用只产生一个 draft。
 */
export async function createDraftVersion(
  submissionId: string,
  createdBy: string,
): Promise<SubmissionVersion> {
  // 尝试 RPC
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'create_submission_draft_version',
    { p_submission_id: submissionId },
  )

  if (!rpcErr && rpcData) {
    const rows = Array.isArray(rpcData) ? rpcData : [rpcData]
    return rows[0] as SubmissionVersion
  }

  // 回退：直接创建 draft（迁移前）
  const versions = await listVersions(submissionId)
  const existingDraft = versions.find((v) => !v.finalized)
  if (existingDraft) return existingDraft

  const nextNo = (versions[0]?.version_no ?? 0) + 1
  const { data, error } = await supabase
    .from('submission_versions')
    .insert({
      submission_id: submissionId,
      version_no: nextNo,
      finalized: false,
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as SubmissionVersion
}

/**
 * 正式提交（优先 RPC，带乐观锁）。
 * 幂等：重复调用同一已 finalize 版本直接返回。
 */
export async function finalizeSubmission(params: {
  submission: Submission
  versionId: string
  createdBy: string
  textAnswer: string
  note?: string
}): Promise<{ submission: Submission; version: SubmissionVersion }> {
  const { submission, versionId, textAnswer, note, createdBy: _createdBy } = params

  // 先保存最新的 text_answer 到 draft
  void _createdBy // keep param for API compatibility
  const { error: saveErr } = await supabase
    .from('submission_versions')
    .update({ text_answer: textAnswer, note: note ?? null })
    .eq('id', versionId)
    .eq('finalized', false)

  // 尝试 RPC
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'finalize_submission',
    {
      p_submission_id: submission.id,
      p_version_id: versionId,
      p_expected_version: submission.version,
    },
  )

  if (!rpcErr && rpcData) {
    void saveErr // RPC succeeded, ignore saveErr
    // 重新获取完整 submission 和 version
    const [sub, ver] = await Promise.all([
      getSubmissionById(submission.id),
      supabase
        .from('submission_versions')
        .select('*')
        .eq('id', versionId)
        .single()
        .then(({ data }) => data as SubmissionVersion),
    ])
    return { submission: sub!, version: ver! }
  }

  // 回退：直接操作 DB（迁移前行为，迁移后会被 trigger 阻断）
  if (rpcErr && rpcErr.message.includes('Direct UPDATE on submissions is forbidden')) {
    throw new Error('Migration applied: direct updates blocked. RPC not available.')
  }

  // 保存 text_answer 后直接 finalize
  const { data: verData, error: verErr } = await supabase
    .from('submission_versions')
    .update({ finalized: true, finalized_at: new Date().toISOString() })
    .eq('id', versionId)
    .eq('finalized', false)
    .select('*')
    .single()
  if (verErr) throw verErr

  const version = verData as SubmissionVersion
  const nextStatus = submission.status === 'draft' ? 'submitted' : 'resubmitted'

  const { data: subData, error: subErr } = await supabase
    .from('submissions')
    .update({ status: nextStatus, current_version_id: version.id })
    .eq('id', submission.id)
    .select('*')
    .single()
  if (subErr) throw subErr

  return { submission: subData as Submission, version }
}

/**
 * 旧版 finalizeTextSubmission — 创建一个新的 finalized 版本。
 * 迁移后建议改用 createDraftVersion + uploadSubmissionFile + finalizeSubmission 流程。
 */
export async function finalizeTextSubmission(params: {
  submission: Submission
  createdBy: string
  textAnswer: string
  note?: string
}): Promise<{ submission: Submission; version: SubmissionVersion }> {
  const { submission, createdBy, textAnswer, note } = params

  // 计算下一个版本号
  const versions = await listVersions(submission.id)
  const nextNo = (versions[0]?.version_no ?? 0) + 1

  const { data: ver, error: vErr } = await supabase
    .from('submission_versions')
    .insert({
      submission_id: submission.id,
      version_no: nextNo,
      text_answer: textAnswer,
      note: note ?? null,
      finalized: true,
      finalized_at: new Date().toISOString(),
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (vErr) throw vErr
  const version = ver as SubmissionVersion

  const nextStatus = submission.status === 'draft' ? 'submitted' : 'resubmitted'
  const { data: sub, error: sErr } = await supabase
    .from('submissions')
    .update({ status: nextStatus, current_version_id: version.id })
    .eq('id', submission.id)
    .select('*')
    .single()
  if (sErr) throw sErr

  return { submission: sub as Submission, version }
}

/** 保存离线/在线草稿版本（未 finalize，可覆盖同版本）。 */
export async function saveDraftVersion(params: {
  submission: Submission
  createdBy: string
  textAnswer: string
}): Promise<SubmissionVersion> {
  const { submission, createdBy, textAnswer } = params
  const versions = await listVersions(submission.id)
  const draft = versions.find((v) => !v.finalized)

  if (draft) {
    const { data, error } = await supabase
      .from('submission_versions')
      .update({ text_answer: textAnswer })
      .eq('id', draft.id)
      .select('*')
      .single()
    if (error) throw error
    return data as SubmissionVersion
  }

  const nextNo = (versions[0]?.version_no ?? 0) + 1
  const { data, error } = await supabase
    .from('submission_versions')
    .insert({
      submission_id: submission.id,
      version_no: nextNo,
      text_answer: textAnswer,
      finalized: false,
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as SubmissionVersion
}

// ============================================================
// 文件操作
// ============================================================

/** 列出某版本的所有文件 */
export async function listSubmissionFiles(
  versionId: string,
): Promise<SubmissionFile[]> {
  const { data, error } = await supabase
    .from('submission_files')
    .select('*')
    .eq('version_id', versionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as SubmissionFile[]) ?? []
}

/** 生成短期签名 URL（5 分钟有效）。仅教师调用生成，前端不直接暴露 object_key。 */
export async function createSignedFileUrl(
  objectKey: string,
  expiresIn = 300,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('submissions')
    .createSignedUrl(objectKey, expiresIn)
  if (error) throw error
  return data.signedUrl
}

/** 上传文件到 Storage 并写入 submission_files 记录。
 *  上传失败或 DB 写入失败时自动清理孤立对象。 */
export async function uploadSubmissionFile(params: {
  submissionId: string
  versionId: string
  organizationId: string
  studentId: string
  file: File
  onProgress?: (progress: number) => void
}): Promise<SubmissionFile> {
  const { submissionId, versionId, organizationId, studentId, file, onProgress: _onProgress } = params
  void _onProgress // kept for API compatibility; progress tracking via Supabase realtime

  // 1. 计算 SHA-256
  const sha256 = await computeSHA256(file)

  // 2. 构建对象路径
  const objectKey = buildObjectPath({
    organizationId,
    studentId,
    submissionId,
    versionId,
    fileName: file.name,
  })

  // 3. 上传到 Storage（upsert: false，不覆盖已有文件）
  const { error: uploadErr } = await supabase.storage
    .from('submissions')
    .upload(objectKey, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  // 4. 写入 submission_files 记录
  const { data: fileRecord, error: dbErr } = await supabase
    .from('submission_files')
    .insert({
      version_id: versionId,
      submission_id: submissionId,
      organization_id: organizationId,
      file_name: file.name,
      object_key: objectKey,
      file_size: file.size,
      mime_type: file.type || 'application/octet-stream',
      sha256,
      scan_status: 'pending',
      bucket: 'submissions',
      created_by: studentId,
    })
    .select('*')
    .single()

  if (dbErr) {
    // DB 写入失败 → 删除孤立 Storage 对象
    await supabase.storage.from('submissions').remove([objectKey])
    throw new Error(`DB insert failed, orphan cleaned: ${dbErr.message}`)
  }

  return fileRecord as SubmissionFile
}

/** 删除未 finalize 版本的文件（同时删除 DB 记录和 Storage 对象） */
export async function deleteSubmissionFile(
  fileRecord: SubmissionFile,
): Promise<void> {
  // 先删 DB 记录
  const { error: dbErr } = await supabase
    .from('submission_files')
    .delete()
    .eq('id', fileRecord.id)
  if (dbErr) throw new Error(`Delete file record failed: ${dbErr.message}`)

  // 再删 Storage 对象（失败不影响 DB 一致性，RLS 会阻止后续访问）
  await supabase.storage.from('submissions').remove([fileRecord.object_key])
}

/** 判断文件是否为图片 */
export function isImageFile(file: SubmissionFile): boolean {
  return file.mime_type.startsWith('image/')
}

/** 判断文件是否为 PDF */
export function isPdfFile(file: SubmissionFile): boolean {
  return file.mime_type === 'application/pdf'
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
