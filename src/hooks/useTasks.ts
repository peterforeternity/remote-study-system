import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listTeacherTasks,
  listStudentTasks,
  getTask,
  getTaskQuestions,
  getTaskResources,
  createTask,
  updateTaskStatus,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '@/services/tasks'
import type { TaskStatus } from '@/types'

export function useTeacherTasks() {
  return useQuery({ queryKey: ['tasks', 'teacher'], queryFn: listTeacherTasks })
}

export function useStudentTasks() {
  return useQuery({ queryKey: ['tasks', 'student'], queryFn: listStudentTasks })
}

export function useTask(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: () => getTask(taskId!),
    enabled: Boolean(taskId),
  })
}

export function useTaskQuestions(taskId: string | undefined, includeAnswerKey: boolean) {
  return useQuery({
    queryKey: ['task-questions', taskId, includeAnswerKey],
    queryFn: () => getTaskQuestions(taskId!, includeAnswerKey),
    enabled: Boolean(taskId),
  })
}

export function useTaskResources(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task-resources', taskId],
    queryFn: () => getTaskResources(taskId!),
    enabled: Boolean(taskId),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { taskId: string; status: TaskStatus }) =>
      updateTaskStatus(params.taskId, params.status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task'] })
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { taskId: string; input: UpdateTaskInput }) =>
      updateTask(params.taskId, params.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task'] })
      qc.invalidateQueries({ queryKey: ['task-questions'] })
      qc.invalidateQueries({ queryKey: ['task-resources'] })
    },
  })
}
