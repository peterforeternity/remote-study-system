import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, FolderPlus, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TaskStatusBadge } from '@/components/ui/StatusBadge'
import { TaskFormModal } from '@/components/TaskFormModal'
import { useTeacherTasks, useUpdateTaskStatus, useTaskQuestions, useTaskResources } from '@/hooks/useTasks'
import { useMyClasses, useCreateClass } from '@/hooks/useClasses'
import { useAuthStore } from '@/store/useAuthStore'
import { supabase } from '@/lib/supabase'
import type { Task } from '@/types'

export default function Tasks() {
  const { profile } = useAuthStore()
  const tasks = useTeacherTasks()
  const classes = useMyClasses()
  const createClass = useCreateClass()
  const updateStatus = useUpdateTaskStatus()
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editClassId, setEditClassId] = useState('')
  const [newClassName, setNewClassName] = useState('')

  // 编辑模式下加载任务详情
  const { data: editQuestions } = useTaskQuestions(editingTask?.id, true)
  const { data: editResources } = useTaskResources(editingTask?.id)

  // 加载编辑任务的班级分配
  useEffect(() => {
    if (!editingTask) return
    supabase
      .from('task_assignees')
      .select('class_id')
      .eq('task_id', editingTask.id)
      .maybeSingle()
      .then(({ data }) => setEditClassId(data?.class_id ?? ''))
    return () => setEditClassId('')
  }, [editingTask])

  const handleCreateClass = async () => {
    if (!profile || !newClassName.trim()) return
    await createClass.mutateAsync({
      organizationId: profile.organization_id,
      name: newClassName.trim(),
      createdBy: profile.id,
    })
    setNewClassName('')
  }

  const handleEdit = (t: Task) => {
    setEditingTask(t)
    setShowTaskModal(true)
  }

  const handleCloseModal = () => {
    setShowTaskModal(false)
    setEditingTask(null)
  }

  // 从 task_resources + task_assignees 提取链接资源和班级 ID
  const mappedQuestions = editQuestions?.map((q) => ({
    type: q.type,
    content: q.content,
    answer_key: q.answer_key ?? '',
    score: q.score,
  }))
  const mappedResources = (editResources ?? [])
    .filter((r) => r.type === 'link')
    .map((r) => ({ title: r.title, url: r.url }))

  return (
    <div>
      <PageHeader
        title="任务管理"
        subtitle="创建、发布与归档学习任务"
        action={
          <Button onClick={() => setShowTaskModal(true)}>
            <Plus size={16} /> 新建任务
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardBody>
            <h2 className="mb-3 flex items-center gap-2 font-display font-semibold">
              <FolderPlus size={18} /> 我的班级
            </h2>
            <div className="mb-3 flex gap-2">
              <input
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="新班级名称"
                className="flex-1 rounded border border-border bg-bg px-3 py-1.5 text-sm"
              />
              <Button
                variant="secondary"
                onClick={handleCreateClass}
                disabled={createClass.isPending}
              >
                创建
              </Button>
            </div>
            <ul className="space-y-1 text-sm">
              {(classes.data ?? []).map((c) => (
                <li key={c.id} className="rounded px-2 py-1.5 hover:bg-bg">
                  {c.name}
                </li>
              ))}
              {classes.data?.length === 0 && (
                <li className="text-xs text-muted">尚无班级，请先创建。</li>
              )}
            </ul>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardBody>
            <h2 className="mb-3 font-display font-semibold">任务列表</h2>
            {tasks.isLoading ? (
              <p className="text-sm text-muted">加载中…</p>
            ) : tasks.data?.length === 0 ? (
              <p className="text-sm text-muted">还没有任务，点击右上角新建。</p>
            ) : (
              <ul className="divide-y divide-border">
                {(tasks.data ?? []).map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <Link to={`/tasks/${t.id}`} className="font-medium hover:text-primary">
                        {t.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {t.subject} · 满分 {t.full_score}
                      </p>
                    </div>
                    <TaskStatusBadge status={t.status} />
                    {t.status === 'draft' && (
                      <>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => handleEdit(t)}
                        >
                          <Pencil size={12} className="mr-1" /> 编辑
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-2 py-1 text-xs"
                          onClick={() =>
                            updateStatus.mutate({ taskId: t.id, status: 'published' })
                          }
                        >
                          发布
                        </Button>
                      </>
                    )}
                    {t.status === 'published' && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() =>
                          updateStatus.mutate({ taskId: t.id, status: 'archived' })
                        }
                      >
                        归档
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {showTaskModal && (
        <TaskFormModal
          onClose={handleCloseModal}
          task={editingTask ?? undefined}
          editQuestions={editingTask ? mappedQuestions : undefined}
          editResources={editingTask ? mappedResources : undefined}
          editClassId={editingTask ? editClassId : undefined}
        />
      )}
    </div>
  )
}
