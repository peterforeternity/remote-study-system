import { create } from 'zustand'
import type { Task } from '@/types'

interface TaskFormState {
  open: boolean
  editingTask: Task | null
  openCreate: () => void
  openEdit: (task: Task) => void
  close: () => void
}

export const useTaskFormStore = create<TaskFormState>((set) => ({
  open: false,
  editingTask: null,
  openCreate: () => set({ open: true, editingTask: null }),
  openEdit: (task) => set({ open: true, editingTask: task }),
  close: () => set({ open: false, editingTask: null }),
}))
