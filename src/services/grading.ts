import { supabase } from '@/lib/supabase'
import type { GradingSession, Annotation, SubmissionVersion, ErrorSeverity, ErrorCategory } from '@/types'

// ============================================================
// 批改服务：开启批改会话、打分评语、批注、发布/退回。
// 正式数据先写库；乐观锁 version 字段防止并发覆盖。
// ============================================================

/** 获取（或创建）某作业的批改会话。 */
export async function getOrCreateGrading(params: {
  submissionId: string
  organizationId: string
  graderId: string
}): Promise<GradingSession> {
  const { data: existing, error } = await supabase
    .from('grading_sessions')
    .select('*')
    .eq('submission_id', params.submissionId)
    .maybeSingle()
  if (error) throw error
  if (existing) return existing as GradingSession

  const { data, error: cErr } = await supabase
    .from('grading_sessions')
    .insert({
      submission_id: params.submissionId,
      organization_id: params.organizationId,
      grader_id: params.graderId,
      status: 'draft',
    })
    .select('*')
    .single()
  if (cErr) throw cErr

  // 将作业状态推进为 grading
  await supabase
    .from('submissions')
    .update({ status: 'grading' })
    .eq('id', params.submissionId)

  return data as GradingSession
}

/** 保存批改草稿（打分+评语），带乐观锁校验。 */
export async function saveGradingDraft(params: {
  grading: GradingSession
  score: number | null
  comment: string
  aiAccepted?: boolean
}): Promise<GradingSession> {
  const { grading, score, comment, aiAccepted } = params
  const { data, error } = await supabase
    .from('grading_sessions')
    .update({
      score,
      comment,
      ai_accepted: aiAccepted ?? grading.ai_accepted,
      version: grading.version + 1,
    })
    .eq('id', grading.id)
    .eq('version', grading.version) // 乐观锁
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('批改记录已被其他会话更新，请刷新后重试（乐观锁冲突）')
  return data as GradingSession
}

/** 发布最终成绩：批改会话 finalized，作业状态 graded，并通知学生。 */
export async function finalizeGrading(params: {
  grading: GradingSession
  submissionId: string
  studentId: string
  organizationId: string
  taskTitle: string
}): Promise<void> {
  const { grading, submissionId, studentId, organizationId, taskTitle } = params
  const { error } = await supabase
    .from('grading_sessions')
    .update({
      status: 'finalized',
      graded_at: new Date().toISOString(),
      version: grading.version + 1,
    })
    .eq('id', grading.id)
    .eq('version', grading.version)
  if (error) throw error

  await supabase.from('submissions').update({ status: 'graded' }).eq('id', submissionId)

  // 通知先落库，Realtime 会广播
  await supabase.from('notifications').insert({
    recipient_id: studentId,
    organization_id: organizationId,
    type: 'grading.finalized',
    title: `《${taskTitle}》已批改完成`,
    payload: { submissionId },
  })
}

/** 退回修改：批改会话 returned，作业状态 returned。 */
export async function returnGrading(params: {
  gradingId: string
  submissionId: string
  studentId: string
  organizationId: string
  taskTitle: string
}): Promise<void> {
  await supabase
    .from('grading_sessions')
    .update({ status: 'returned' })
    .eq('id', params.gradingId)
  await supabase
    .from('submissions')
    .update({ status: 'returned' })
    .eq('id', params.submissionId)
  await supabase.from('notifications').insert({
    recipient_id: params.studentId,
    organization_id: params.organizationId,
    type: 'grading.returned',
    title: `《${params.taskTitle}》已退回修改`,
    payload: { submissionId: params.submissionId },
  })
}

export async function listAnnotations(gradingId: string): Promise<Annotation[]> {
  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('grading_id', gradingId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as Annotation[]) ?? []
}

export async function addAnnotation(params: {
  gradingId: string
  text: string
  severity: ErrorSeverity
  errorCategory: ErrorCategory | null
}): Promise<Annotation> {
  const { data, error } = await supabase
    .from('annotations')
    .insert({
      grading_id: params.gradingId,
      text: params.text,
      severity: params.severity,
      error_category: params.errorCategory,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Annotation
}

export async function deleteAnnotation(id: string): Promise<void> {
  const { error } = await supabase.from('annotations').delete().eq('id', id)
  if (error) throw error
}

/** 获取作业的最新提交版本内容（供教师批改时查看）。 */
export async function getLatestFinalizedVersion(
  submissionId: string,
): Promise<SubmissionVersion | null> {
  const { data, error } = await supabase
    .from('submission_versions')
    .select('*')
    .eq('submission_id', submissionId)
    .eq('finalized', true)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as SubmissionVersion) ?? null
}
