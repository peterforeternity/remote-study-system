import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getMySubmission,
  getSubmissionById,
  listTaskSubmissions,
  createSubmission,
  finalizeSubmission,
  saveDraftVersion,
  createDraftVersion,
  listVersions,
  listSubmissionFiles,
  uploadSubmissionFile,
  deleteSubmissionFile,
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

export function useSubmissionFiles(versionId: string | undefined) {
  return useQuery({
    queryKey: ['submission-files', versionId],
    queryFn: () => listSubmissionFiles(versionId!),
    enabled: Boolean(versionId),
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
    mutationFn: async (params: {
      submission: Submission
      createdBy: string
      textAnswer: string
      note?: string
    }) => {
      // 查找当前 draft version，通过 RPC finalize
      const versions = await listVersions(params.submission.id)
      const draftVersion = versions.find((v) => !v.finalized)
      if (!draftVersion) {
        throw new Error('No draft version found to finalize')
      }
      return finalizeSubmission({
        submission: params.submission,
        versionId: draftVersion.id,
        createdBy: params.createdBy,
        textAnswer: params.textAnswer,
        note: params.note,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission'] })
      qc.invalidateQueries({ queryKey: ['task-submissions'] })
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission-versions'] })
      qc.invalidateQueries({ queryKey: ['submission-files'] })
    },
  })
}

/** 新版 finalize：使用 draft version ID 而非创建新版本（适配 RPC） */
export function useFinalizeDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      submission: Submission
      versionId: string
      createdBy: string
      textAnswer: string
      note?: string
    }) => finalizeSubmission(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission'] })
      qc.invalidateQueries({ queryKey: ['task-submissions'] })
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission-versions'] })
      qc.invalidateQueries({ queryKey: ['submission-files'] })
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

export function useCreateDraftVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { submissionId: string; createdBy: string }) =>
      createDraftVersion(params.submissionId, params.createdBy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission-versions'] })
    },
  })
}

export function useUploadSubmissionFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: uploadSubmissionFile,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['submission-files', variables.versionId] })
    },
  })
}

export function useDeleteSubmissionFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteSubmissionFile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission-files'] })
    },
  })
}
