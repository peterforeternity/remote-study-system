/**
 * 创建测试用户脚本（Admin API）。
 *
 * 为什么需要它：直接向 auth.users 表 INSERT 无法可靠生成可登录账号
 * （缺少 GoTrue 内部处理），因此测试用户必须通过 Admin API 创建。
 *
 * 用法：
 *   1. 在项目根准备 .env，填入 SUPABASE_URL 与 SUPABASE_SECRET_KEY（service_role 密钥）
 *   2. node --env-file=.env scripts/create-test-users.mjs
 *      （Node 18 用 dotenv；Node 20.6+ 支持 --env-file）
 *
 * 该脚本会：创建 4 个测试账号 → 关联到"示范中学"机构 →
 * 写入 profiles → 创建班级并加入成员。密码统一 Passw0rd!。
 *
 * 注意：使用 service_role 密钥，仅在本地/受控环境运行，切勿提交密钥。
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY 环境变量。')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ORG_ID = '00000000-0000-0000-0000-0000000000aa'
const CLASS_ID = '00000000-0000-0000-0000-0000000000c1'
const PASSWORD = 'Passw0rd!'

const USERS = [
  { email: 'teacher@example.com', name: '李老师', role: 'teacher' },
  { email: 'student1@example.com', name: '王同学', role: 'student' },
  { email: 'student2@example.com', name: '张同学', role: 'student' },
  { email: 'admin@example.com', name: '管理员', role: 'admin' },
]

async function ensureOrg() {
  const { error } = await admin
    .from('organizations')
    .upsert({ id: ORG_ID, name: '示范中学' }, { onConflict: 'id' })
  if (error) throw error
}

async function createUser(u) {
  // 1) 创建 auth 用户（已确认邮箱，可直接登录）
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: u.name },
  })
  let userId = data?.user?.id
  if (error) {
    if (!/already been registered|already exists/i.test(error.message)) throw error
    // 已存在则查回 id
    const { data: list } = await admin.auth.admin.listUsers()
    userId = list.users.find((x) => x.email === u.email)?.id
  }
  if (!userId) throw new Error(`无法获取用户 id: ${u.email}`)

  // 2) 写入 profile
  const { error: pErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      organization_id: ORG_ID,
      name: u.name,
      role: u.role,
      email: u.email,
    },
    { onConflict: 'id' },
  )
  if (pErr) throw pErr
  console.log(`✓ ${u.role.padEnd(7)} ${u.email} (${userId})`)
  return { ...u, id: userId }
}

async function ensureClass(teacherId, studentIds) {
  await admin
    .from('classes')
    .upsert(
      { id: CLASS_ID, organization_id: ORG_ID, name: '初二(3)班', created_by: teacherId },
      { onConflict: 'id' },
    )
  const members = [
    { class_id: CLASS_ID, profile_id: teacherId, role_in_class: 'teacher' },
    ...studentIds.map((id) => ({ class_id: CLASS_ID, profile_id: id, role_in_class: 'student' })),
  ]
  const { error } = await admin
    .from('class_members')
    .upsert(members, { onConflict: 'class_id,profile_id' })
  if (error) throw error
  console.log('✓ 班级 初二(3)班 与成员已就绪')
}

async function ensureSampleTask(teacherId) {
  const TASK_ID = '00000000-0000-0000-0000-0000000000d1'
  const dueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
  await admin.from('tasks').upsert(
    {
      id: TASK_ID,
      organization_id: ORG_ID,
      title: '一元二次方程练习',
      description: '完成课本第 3 章习题，重点掌握求根公式与判别式。',
      subject: '数学',
      status: 'published',
      due_date: dueDate,
      full_score: 100,
      creator_id: teacherId,
    },
    { onConflict: 'id' },
  )
  await admin.from('task_assignees').delete().eq('task_id', TASK_ID)
  await admin.from('task_assignees').insert({ task_id: TASK_ID, class_id: CLASS_ID })
  // 题目：先清后插，避免重复
  await admin.from('task_questions').delete().eq('task_id', TASK_ID)
  await admin.from('task_questions').insert([
    {
      task_id: TASK_ID,
      order_no: 1,
      type: 'single',
      content: '方程 x^2-5x+6=0 的根是？ A.2和3 B.1和6 C.-2和-3 D.无实根',
      answer_key: 'A',
      score: 40,
    },
    {
      task_id: TASK_ID,
      order_no: 2,
      type: 'subjective',
      content: '请写出求根公式并推导判别式的意义。',
      answer_key: null,
      score: 60,
    },
  ])
  console.log('✓ 示例任务《一元二次方程练习》已发布')
}

async function main() {
  console.log('创建测试用户中…')
  await ensureOrg()
  const created = []
  for (const u of USERS) {
    created.push(await createUser(u))
  }
  const teacher = created.find((u) => u.role === 'teacher')
  const students = created.filter((u) => u.role === 'student').map((u) => u.id)
  await ensureClass(teacher.id, students)
  await ensureSampleTask(teacher.id)
  console.log('\n完成。测试账号密码统一：', PASSWORD)
}

main().catch((e) => {
  console.error('失败:', e.message)
  process.exit(1)
})
