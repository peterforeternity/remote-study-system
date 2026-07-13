import { supabase } from '@/lib/supabase'
import type { SubmissionEvent, SubmissionEventType } from '@/types'

// ============================================================
// 防作弊行为日志服务：记录切屏/失焦/粘贴等事件，供教师批改参考。
// 数据写入 submission_events，RLS 保证学生仅能写自己的作业事件。
// ============================================================

export async function logSubmissionEvent(params: {
  submissionId: string
  studentId: string
  organizationId: string
  eventType: SubmissionEventType
  detail?: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabase.from('submission_events').insert({
    submission_id: params.submissionId,
    student_id: params.studentId,
    organization_id: params.organizationId,
    event_type: params.eventType,
    detail: params.detail ?? null,
  })
  // 行为日志失败不应阻断学生答题，仅在控制台提示
  if (error) console.warn('记录作弊行为事件失败:', error.message)
}

export async function listSubmissionEvents(
  submissionId: string,
): Promise<SubmissionEvent[]> {
  const { data, error } = await supabase
    .from('submission_events')
    .select('*')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as SubmissionEvent[]) ?? []
}
