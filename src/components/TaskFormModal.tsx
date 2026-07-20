import { useState, useRef } from 'react'
import { X, Plus, Trash2, ExternalLink, Upload, FileText, Loader2 } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { useCreateTask } from '@/hooks/useTasks'
import { useMyClasses } from '@/hooks/useClasses'
import { useAuthStore } from '@/store/useAuthStore'
import { supabase } from '@/lib/supabase'
import type { QuestionType } from '@/types'

interface QuestionField {
  type: QuestionType
  content: string
  answer_key: string
  score: number
}

interface ResourceField {
  title: string
  url: string
}

interface FormValues {
  title: string
  subject: string
  description: string
  dueDate: string
  fullScore: number
  classId: string
  questions: QuestionField[]
  resources: ResourceField[]
}

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'judge', label: '判断题' },
  { value: 'blank', label: '填空题' },
  { value: 'numeric', label: '数值题' },
  { value: 'subjective', label: '主观题' },
  { value: 'dictation', label: '听写题' },
]

export function TaskFormModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuthStore()
  const classes = useMyClasses()
  const createTask = useCreateTask()
  const [error, setError] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, control, handleSubmit, watch } = useForm<FormValues>({
    defaultValues: {
      title: '',
      subject: '数学',
      description: '',
      dueDate: '',
      fullScore: 100,
      classId: '',
      questions: [{ type: 'single', content: '', answer_key: '', score: 100 }],
      resources: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'questions' })
  const { fields: resourceFields, append: appendResource, remove: removeResource } = useFieldArray({ control, name: 'resources' })

  const onSubmit = async (values: FormValues) => {
    setError(null)
    if (!profile) return
    try {
      const task = await createTask.mutateAsync({
        organizationId: profile.organization_id,
        creatorId: profile.id,
        title: values.title,
        description: values.description,
        subject: values.subject,
        dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : null,
        fullScore: Number(values.fullScore),
        classId: values.classId || null,
        questions: values.questions.map((q, i) => ({
          order_no: i + 1,
          type: q.type,
          content: q.content,
          answer_key:
            q.type === 'subjective'
              ? null
              : q.type === 'dictation'
                ? q.answer_key || q.content
                : q.answer_key || null,
          score: Number(q.score),
        })),
        resources: values.resources
          .filter((r) => r.title && r.url)
          .map((r) => ({ title: r.title, url: r.url })),
      })

      // 上传文件到 Storage
      if (selectedFiles.length > 0) {
        setUploading(true)
        const prefix = `${profile.organization_id}/tasks/${task.id}/resources`
        const fileRecords: { title: string; url: string; type: string }[] = []

        for (const file of selectedFiles) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_')
          const path = `${prefix}/${safeName}`
          const { error: upErr } = await supabase.storage
            .from('task-resources')
            .upload(path, file, { upsert: false })
          if (upErr) throw upErr

          const { data: urlData } = supabase.storage
            .from('task-resources')
            .getPublicUrl(path)
          fileRecords.push({
            title: file.name,
            url: urlData.publicUrl,
            type: 'file',
          })
        }

        // 保存文件记录到 task_resources
        const { error: rErr } = await supabase.from('task_resources').insert(
          fileRecords.map((r) => ({ ...r, task_id: task.id })),
        )
        if (rErr) throw rErr
        setUploading(false)
      }

      onClose()
    } catch (err) {
      setUploading(false)
      setError(err instanceof Error ? err.message : '创建任务失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-surface shadow-soft">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-lg font-semibold">创建学习任务</h2>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium">任务标题</label>
              <input
                {...register('title', { required: true })}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">科目</label>
              <input
                {...register('subject')}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">满分</label>
              <input
                type="number"
                {...register('fullScore')}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">截止时间</label>
              <input
                type="datetime-local"
                {...register('dueDate')}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">分配班级</label>
              <select
                {...register('classId')}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">暂不分配</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium">任务描述</label>
              <textarea
                {...register('description')}
                rows={2}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">题目</label>
              <button
                type="button"
                onClick={() => append({ type: 'single', content: '', answer_key: '', score: 0 })}
                className="flex items-center gap-1 text-sm text-primary"
              >
                <Plus size={14} /> 添加题目
              </button>
            </div>
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="rounded border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      {...register(`questions.${index}.type`)}
                      className="rounded border border-border bg-bg px-2 py-1 text-xs"
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      {...register(`questions.${index}.score`)}
                      placeholder="分值"
                      className="w-20 rounded border border-border bg-bg px-2 py-1 text-xs"
                    />
                    {fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="ml-auto text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <input
                    {...register(`questions.${index}.content`)}
                    placeholder={
                      watch(`questions.${index}.type`) === 'dictation'
                        ? '听写内容（朗读给学生的词/句，如 elephant）'
                        : '题干内容'
                    }
                    className="mb-2 w-full rounded border border-border bg-bg px-2 py-1.5 text-sm"
                  />
                  <input
                    {...register(`questions.${index}.answer_key`)}
                    placeholder={
                      watch(`questions.${index}.type`) === 'dictation'
                        ? '标准答案（留空则默认与听写内容相同）'
                        : '标准答案（主观题可留空）'
                    }
                    className="w-full rounded border border-border bg-bg px-2 py-1.5 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <ExternalLink size={14} /> 参考资料
              </label>
              <button
                type="button"
                onClick={() => appendResource({ title: '', url: '' })}
                className="flex items-center gap-1 text-sm text-primary"
              >
                <Plus size={14} /> 添加链接
              </button>
            </div>
            <p className="mb-2 text-xs text-muted">添加学生可查看的参考链接（可选）</p>
            <div className="space-y-2">
              {resourceFields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-2">
                  <input
                    {...register(`resources.${index}.title`)}
                    placeholder="链接标题（如：课本第三章PPT）"
                    className="flex-1 rounded border border-border bg-bg px-2 py-1.5 text-sm"
                  />
                  <input
                    {...register(`resources.${index}.url`)}
                    placeholder="https://..."
                    className="flex-[2] rounded border border-border bg-bg px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeResource(index)}
                    className="text-danger shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Upload size={14} /> 附件上传
            </label>
            <p className="mb-2 text-xs text-muted">上传教学资料（PDF/文档/图片等），学生可下载查看</p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                setSelectedFiles((prev) => [...prev, ...files])
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="hidden"
            />

            {selectedFiles.length > 0 && (
              <ul className="mb-2 space-y-1">
                {selectedFiles.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-sm">
                    <span className="flex items-center gap-1.5 truncate">
                      <FileText size={14} className="text-muted shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="text-xs text-muted shrink-0">
                        ({(f.size / 1024).toFixed(0)} KB)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="ml-2 text-danger shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-primary hover:text-primary"
            >
              <Plus size={14} /> 选择文件
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={createTask.isPending || uploading}>
              {createTask.isPending ? '创建中…' : uploading ? (
                <span className="flex items-center gap-1"><Loader2 size={14} className="animate-spin" /> 上传文件中…</span>
              ) : '创建草稿'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
