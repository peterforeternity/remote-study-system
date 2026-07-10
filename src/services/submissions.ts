import { supabase } from '@/lib/supabase'
import type { Submission, SubmissionVersion, Profile } from '@/types'

// ============================================================
// 作业服务：创建作业、创建版本、正式提交。
// 数据全部落库，状态流转严格遵循状态机。
// ============================================================

export interface SubmissionWithStudent extends Submission {
  student?: Pick<Profile, 'id' | 'name' | 'email'>
}

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

/**
 * 正式提交文本作业：创建一个新的 finalized 版本，并更新作业状态为 submitted。
 * 每次重新提交都新增版本号，旧版本不可覆盖。
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
