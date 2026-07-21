import { supabase } from '@/lib/supabase'
import type { Task, TaskQuestion, TaskResource, TaskStatus } from '@/types'

// ============================================================
// 任务服务：所有查询均通过 Supabase（RLS 生效），无静态数组。
// ============================================================

export interface TaskWithMeta extends Task {
  questionCount?: number
}

/** 教师视角：本人可管理的任务列表。 */
export async function listTeacherTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Task[]) ?? []
}

/** 学生视角：已分配且已发布的任务（RLS 只会返回可见任务）。 */
export async function listStudentTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('status', 'published')
    .order('due_date', { ascending: true })
  if (error) throw error
  return (data as Task[]) ?? []
}

export async function getTask(taskId: string): Promise<Task | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle()
  if (error) throw error
  return (data as Task) ?? null
}

/** 题目：学生视图不返回 answer_key（避免泄露答案）。 */
export async function getTaskQuestions(
  taskId: string,
  includeAnswerKey: boolean,
): Promise<TaskQuestion[]> {
  const columns = includeAnswerKey
    ? '*'
    : 'id, task_id, order_no, type, content, score, created_at'
  const { data, error } = await supabase
    .from('task_questions')
    .select(columns)
    .eq('task_id', taskId)
    .order('order_no', { ascending: true })
  if (error) throw error
  return (data as unknown as TaskQuestion[]) ?? []
}

export async function getTaskResources(taskId: string): Promise<TaskResource[]> {
  const { data, error } = await supabase
    .from('task_resources')
    .select('*')
    .eq('task_id', taskId)
  if (error) throw error
  return (data as TaskResource[]) ?? []
}

export interface CreateTaskInput {
  organizationId: string
  creatorId: string
  title: string
  description: string
  subject: string
  dueDate: string | null
  fullScore: number
  classId: string | null
  questions: {
    order_no: number
    type: TaskQuestion['type']
    content: string
    answer_key: string | null
    score: number
  }[]
  resources?: { title: string; url: string }[]
}

/** 创建任务（含题目与班级分配）。默认草稿状态。 */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      organization_id: input.organizationId,
      creator_id: input.creatorId,
      title: input.title,
      description: input.description,
      subject: input.subject,
      due_date: input.dueDate,
      full_score: input.fullScore,
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) throw error
  const created = task as Task

  if (input.questions.length > 0) {
    const { error: qErr } = await supabase.from('task_questions').insert(
      input.questions.map((q) => ({ ...q, task_id: created.id })),
    )
    if (qErr) throw qErr
  }

  if (input.classId) {
    const { error: aErr } = await supabase
      .from('task_assignees')
      .insert({ task_id: created.id, class_id: input.classId })
    if (aErr) throw aErr
  }

  if (input.resources && input.resources.length > 0) {
    const { error: rErr } = await supabase.from('task_resources').insert(
      input.resources.map((r) => ({
        task_id: created.id,
        title: r.title,
        url: r.url,
        type: 'link',
      })),
    )
    if (rErr) throw rErr
  }

  return created
}

/** 更新任务状态（发布/关闭/归档）。 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', taskId)
  if (error) throw error
}

export interface UpdateTaskInput {
  title: string
  description: string
  subject: string
  dueDate: string | null
  fullScore: number
  classId: string | null
  questions: {
    order_no: number
    type: TaskQuestion['type']
    content: string
    answer_key: string | null
    score: number
  }[]
  resources?: { title: string; url: string }[]
}

/** 编辑草稿任务。仅 draft 状态可编辑；更新元信息、题目、班级分配和链接资源。 */
export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  // 1. 更新任务元信息
  const { data, error } = await supabase
    .from('tasks')
    .update({
      title: input.title,
      description: input.description,
      subject: input.subject,
      due_date: input.dueDate,
      full_score: input.fullScore,
    })
    .eq('id', taskId)
    .select('*')
    .single()
  if (error) throw error
  const updated = data as Task

  // 2. 替换题目（删除旧的，插入新的）
  await supabase.from('task_questions').delete().eq('task_id', taskId)
  if (input.questions.length > 0) {
    const { error: qErr } = await supabase.from('task_questions').insert(
      input.questions.map((q) => ({ ...q, task_id: taskId })),
    )
    if (qErr) throw qErr
  }

  // 3. 替换班级分配
  await supabase.from('task_assignees').delete().eq('task_id', taskId)
  if (input.classId) {
    await supabase.from('task_assignees').insert({ task_id: taskId, class_id: input.classId })
  }

  // 4. 替换链接资源
  await supabase.from('task_resources').delete().eq('task_id', taskId).eq('type', 'link')
  if (input.resources && input.resources.length > 0) {
    const { error: rErr } = await supabase.from('task_resources').insert(
      input.resources.map((r) => ({
        task_id: taskId,
        title: r.title,
        url: r.url,
        type: 'link',
      })),
    )
    if (rErr) throw rErr
  }

  return updated
}
