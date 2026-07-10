import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listMyClasses, createClass } from '@/services/classes'

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
