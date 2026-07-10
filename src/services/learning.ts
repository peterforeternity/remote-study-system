import { supabase } from '@/lib/supabase'
import type { Grading } from '@/engine/engineTypes'

// ============================================================
// 学习路径数据：拉取当前学生已批改的成绩，转换为引擎输入。
// ============================================================

interface GradingRow {
  score: number | null
  submission: {
    task: { subject: string; full_score: number } | null
  } | null
  annotations: { severity: string; error_category: string | null }[]
}

export async function getStudentGradings(studentId: string): Promise<Grading[]> {
  const { data, error } = await supabase
    .from('grading_sessions')
    .select(
      'score, submission:submissions!inner(task:tasks(subject, full_score)), annotations(severity, error_category)',
    )
    .eq('status', 'finalized')
    .eq('submissions.student_id', studentId)
  if (error) throw error

  const rows = (data as unknown as GradingRow[]) ?? []
  return rows.map((r) => ({
    score: r.score,
    fullScore: r.submission?.task?.full_score ?? 100,
    subject: r.submission?.task?.subject ?? '综合',
    annotations: (r.annotations ?? []).map((a) => ({
      severity: a.severity as Grading['annotations'][number]['severity'],
      errorCategory: a.error_category as Grading['annotations'][number]['errorCategory'],
    })),
  }))
}
