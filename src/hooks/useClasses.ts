import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listMyClasses,
  createClass,
  listOrgStudents,
  listClassMembers,
  addClassMember,
  removeClassMember,
} from '@/services/classes'

export function useMyClasses() {
  return useQuery({ queryKey: ['classes'], queryFn: listMyClasses })
}

export function useCreateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createClass,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  })
}

export function useOrgStudents() {
  return useQuery({ queryKey: ['org-students'], queryFn: listOrgStudents })
}

export function useClassMembers(classId: string) {
  return useQuery({
    queryKey: ['class-members', classId],
    queryFn: () => listClassMembers(classId),
    enabled: !!classId,
  })
}

export function useAddClassMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addClassMember,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['class-members'] })
    },
  })
}

export function useRemoveClassMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: removeClassMember,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['class-members'] })
    },
  })
}
