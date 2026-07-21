import { useState } from 'react'
import { Users, Plus, Trash2, ChevronDown, ChevronRight, UserPlus, X } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/useAuthStore'
import {
  useMyClasses,
  useCreateClass,
  useOrgStudents,
  useClassMembers,
  useAddClassMember,
  useRemoveClassMember,
} from '@/hooks/useClasses'

export function ClassManageCard() {
  const profile = useAuthStore((s) => s.profile)
  const { data: classes = [] } = useMyClasses()
  const createClass = useCreateClass()
  const [newClassName, setNewClassName] = useState('')
  const [expandedClass, setExpandedClass] = useState<string | null>(null)
  const [showAddStudent, setShowAddStudent] = useState<string | null>(null)

  if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) return null

  const handleCreate = async () => {
    const name = newClassName.trim()
    if (!name) return
    await createClass.mutateAsync({
      organizationId: profile.organization_id,
      name,
      createdBy: profile.id,
    })
    setNewClassName('')
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-4 flex items-center gap-2 font-display font-semibold">
          <Users size={18} /> 班级管理
        </h2>

        {classes.length === 0 && (
          <p className="mb-4 text-sm text-muted">暂无班级，先创建一个吧。</p>
        )}

        {classes.map((cls) => (
          <ClassRow
            key={cls.id}
            cls={cls}
            expanded={expandedClass === cls.id}
            onToggle={() =>
              setExpandedClass((prev) => (prev === cls.id ? null : cls.id))
            }
            showAddStudent={showAddStudent === cls.id}
            onToggleAdd={() =>
              setShowAddStudent((prev) => (prev === cls.id ? null : cls.id))
            }
          />
        ))}

        {/* 新建班级 */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="输入班级名称，如：初二(1)班"
            className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <Button onClick={handleCreate} disabled={createClass.isPending || !newClassName.trim()} className="px-3 py-1 text-xs">
            <Plus size={14} className="mr-1" /> 创建
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function ClassRow({
  cls,
  expanded,
  onToggle,
  showAddStudent,
  onToggleAdd,
}: {
  cls: { id: string; name: string }
  expanded: boolean
  onToggle: () => void
  showAddStudent: boolean
  onToggleAdd: () => void
}) {
  return (
    <div className="border-b border-border py-2 last:border-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 text-left text-sm font-medium hover:text-primary"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {cls.name}
      </button>

      {expanded && (
        <div className="mt-2 ml-5 space-y-1">
          <ClassMembers classId={cls.id} />
          <button
            onClick={onToggleAdd}
            className="flex items-center gap-1 text-xs text-muted hover:text-primary"
          >
            <UserPlus size={12} /> 添加学生
          </button>
          {showAddStudent && (
            <AddStudentForm classId={cls.id} onDone={onToggleAdd} />
          )}
        </div>
      )}
    </div>
  )
}

function ClassMembers({ classId }: { classId: string }) {
  const { data: members = [] } = useClassMembers(classId)
  const removeMember = useRemoveClassMember()

  if (members.length === 0) {
    return <p className="text-xs text-muted">暂无学生</p>
  }

  return (
    <>
      {members.map((m) => (
        <div key={m.id} className="flex items-center justify-between text-xs">
          <span>
            {m.profiles?.name ?? m.profile_id}
            <span className="ml-1 text-muted">
              {m.role_in_class === 'teacher' ? '(教师)' : ''}
            </span>
          </span>
          {m.role_in_class === 'student' && (
            <button
              onClick={() => removeMember.mutate(m.id)}
              className="text-danger hover:opacity-75"
              title="移出班级"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
    </>
  )
}

function AddStudentForm({ classId, onDone }: { classId: string; onDone: () => void }) {
  const { data: allStudents = [] } = useOrgStudents()
  const { data: existingMembers = [] } = useClassMembers(classId)
  const addMember = useAddClassMember()

  const existingIds = new Set(existingMembers.map((m) => m.profile_id))
  const available = allStudents.filter((s) => !existingIds.has(s.id))

  const handleAdd = async (studentId: string) => {
    await addMember.mutateAsync({ classId, studentId })
  }

  return (
    <div className="rounded border border-border bg-surface/50 p-2">
      {available.length === 0 ? (
        <p className="text-xs text-muted">没有可添加的学生（所有学生已加入或尚未注册）</p>
      ) : (
        <div className="max-h-32 space-y-0.5 overflow-y-auto">
          {available.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded px-1.5 py-0.5 hover:bg-surface">
              <span className="text-xs">{s.name}</span>
              <button
                onClick={() => handleAdd(s.id)}
                className="text-xs text-primary hover:underline"
              >
                加入
              </button>
            </div>
          ))}
        </div>
      )}
      <button onClick={onDone} className="mt-1.5 flex items-center gap-0.5 text-xs text-muted hover:text-fg">
        <X size={12} /> 收起
      </button>
    </div>
  )
}
