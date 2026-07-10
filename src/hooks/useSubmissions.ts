import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getMySubmission,
  getSubmissionById,
  listTaskSubmissions,
  createSubmission,
  finalizeTextSubmission,
  saveDraftVersion,
  listVersions,
} from '@/services/submissions'
import type { Submission } from '@/types'

export function useSubmission(submissionId: string | undefined) {
  return useQuery({
    queryKey: ['submission', submissionId],
    queryFn: () => getSubmissionById(submissionId!),
    enabled: Boolean(submissionId),
  })
}

export function useMySubmission(taskId: string | undefined, studentId: string | undefined) {
  return useQuery({
    queryKey: ['my-submission', taskId, studentId],
    queryFn: () => getMySubmission(taskId!, studentId!),
    enabled: Boolean(taskId && studentId),
  })
}

export function useTaskSubmissions(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task-submissions', taskId],
    queryFn: () => listTaskSubmissions(taskId!),
    enabled: Boolean(taskId),
  })
}

export function useSubmissionVersions(submissionId: string | undefined) {
  return useQuery({
    queryKey: ['submission-versions', submissionId],
    queryFn: () => listVersions(submissionId!),
    enabled: Boolean(submissionId),
  })
}

export function useCreateSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createSubmission,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission'] })
      qc.invalidateQueries({ queryKey: ['task-submissions'] })
    },
  })
}

export function useFinalizeSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      submission: Submission
      createdBy: string
      textAnswer: string
      note?: string
    }) => finalizeTextSubmission(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission'] })
      qc.invalidateQueries({ queryKey: ['task-submissions'] })
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission-versions'] })
    },
  })
}

export function useSaveDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { submission: Submission; createdBy: string; textAnswer: string }) =>
      saveDraftVersion(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission-versions'] })
    },
  })
}
