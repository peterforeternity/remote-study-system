import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, FolderPlus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TaskStatusBadge } from '@/components/ui/StatusBadge'
import { TaskFormModal } from '@/components/TaskFormModal'
import { useTeacherTasks, useUpdateTaskStatus } from '@/hooks/useTasks'
import { useMyClasses, useCreateClass } from '@/hooks/useClasses'
import { useAuthStore } from '@/store/useAuthStore'

export default function Tasks() {
  const { profile } = useAuthStore()
  const tasks = useTeacherTasks()
  const classes = useMyClasses()
  const createClass = useCreateClass()
  const updateStatus = useUpdateTaskStatus()
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [newClassName, setNewClassName] = useState('')

  const handleCreateClass = async () => {
    if (!profile || !newClassName.trim()) return
    await createClass.mutateAsync({
      organizationId: profile.organization_id,
      name: newClassName.trim(),
      createdBy: profile.id,
    })
    setNewClassName('')
  }

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
                      <Button
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() =>
                          updateStatus.mutate({ taskId: t.id, status: 'published' })
                        }
                      >
                        发布
                      </Button>
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

      {showTaskModal && <TaskFormModal onClose={() => setShowTaskModal(false)} />}
    </div>
  )
}
