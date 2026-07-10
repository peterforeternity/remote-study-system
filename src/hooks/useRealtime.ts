import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================
// 订阅某作业的状态变化（Supabase Realtime）。
// Realtime 仅用于通知；数据以数据库为准，收到事件后使查询失效重新拉取。
// ============================================================

export function useSubmissionRealtime(submissionId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!submissionId) return
    const channel = supabase
      .channel(`submission:${submissionId}:status`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'submissions',
          filter: `id=eq.${submissionId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['submission', submissionId] })
          qc.invalidateQueries({ queryKey: ['my-submission'] })
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'grading_sessions',
          filter: `submission_id=eq.${submissionId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['grading', submissionId] })
          qc.invalidateQueries({ queryKey: ['submission', submissionId] })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [submissionId, qc])
}

/** 教师端：订阅某任务下所有提交的变化。 */
export function useTaskSubmissionsRealtime(taskId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!taskId) return
    const channel = supabase
      .channel(`task:${taskId}:submissions`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'submissions',
          filter: `task_id=eq.${taskId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['task-submissions', taskId] })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [taskId, qc])
}
