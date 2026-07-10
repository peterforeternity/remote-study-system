/**
 * scripts/test-rls.mjs
 * RLS 越权测试。用真实登录会话验证行级安全，记录每项的 HTTP/错误结果。
 *
 * 运行：npm run test:rls
 * 依赖 .env：SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
 *
 * 前置：需存在种子数据（npm run seed:users）。脚本会临时用 student2 造一份提交作为越权目标。
 */
import { assertConfig, signInAs, anonClient, ACCOUNTS, section, log } from './_shared.mjs'

assertConfig()
const CLASS_ID = '00000000-0000-0000-0000-0000000000c1'
let failures = 0
function expect(pass, msg, detail) {
  log(pass, `${msg}${detail ? ` [${detail}]` : ''}`)
  if (!pass) failures++
}

async function main() {
  const teacher = await signInAs(ACCOUNTS.teacher)
  const s1 = await signInAs(ACCOUNTS.student1)
  const s2 = await signInAs(ACCOUNTS.student2)
  const orgId = (await teacher.client.from('profiles').select('organization_id').eq('id', teacher.user.id).single()).data.organization_id

  // 准备：教师建一个已发布任务；student2 创建一份 submission 作为越权目标
  const { data: task } = await teacher.client.from('tasks').insert({
    organization_id: orgId, creator_id: teacher.user.id, title: `RLS测试任务-${Date.now()}`,
    description: '', subject: '数学', full_score: 100, status: 'published',
  }).select('*').single()
  await teacher.client.from('task_assignees').insert({ task_id: task.id, class_id: CLASS_ID })

  const { data: s2sub } = await s2.client.from('submissions').insert({
    task_id: task.id, student_id: s2.user.id, organization_id: orgId, status: 'draft',
  }).select('*').single()
  const { data: s2ver } = await s2.client.from('submission_versions').insert({
    submission_id: s2sub.id, version_no: 1, text_answer: 's2 私密作答', finalized: true,
    finalized_at: new Date().toISOString(), created_by: s2.user.id,
  }).select('*').single()
  await s2.client.from('submissions').update({ status: 'submitted', current_version_id: s2ver.id }).eq('id', s2sub.id)

  section('RLS 越权测试')

  // 1) student1 不能读取 student2 的 submission
  {
    const { data } = await s1.client.from('submissions').select('id').eq('id', s2sub.id)
    expect((data?.length ?? 0) === 0, 'student1 无法读取 student2 的 submission', `返回 ${data?.length ?? 0} 条`)
  }

  // 2) student1 不能修改 student2 的 submission
  {
    const { data, error } = await s1.client.from('submissions').update({ status: 'graded' }).eq('id', s2sub.id).select('id')
    const blocked = (data?.length ?? 0) === 0 // RLS 使 update 命中 0 行
    expect(blocked, 'student1 无法修改 student2 的 submission', error ? error.message : `影响 ${data?.length ?? 0} 行`)
  }

  // 3) student1 不能创建 task
  {
    const { error } = await s1.client.from('tasks').insert({
      organization_id: orgId, creator_id: s1.user.id, title: '学生非法建任务', description: '', subject: '数学', full_score: 100, status: 'draft',
    }).select('id').single()
    expect(!!error, 'student1 无法创建 task', error ? `被拒: ${error.code}` : '竟然成功(异常)')
  }

  // 3b) student1 不能发布（更新）他人 task
  {
    const { data } = await s1.client.from('tasks').update({ status: 'archived' }).eq('id', task.id).select('id')
    expect((data?.length ?? 0) === 0, 'student1 无法发布/修改教师的 task', `影响 ${data?.length ?? 0} 行`)
  }

  // 4) 未登录用户不能读取 task / submission / grading
  {
    const anon = anonClient()
    const t = await anon.from('tasks').select('id').limit(1)
    const s = await anon.from('submissions').select('id').limit(1)
    const g = await anon.from('grading_sessions').select('id').limit(1)
    const allEmpty = (t.data?.length ?? 0) === 0 && (s.data?.length ?? 0) === 0 && (g.data?.length ?? 0) === 0
    expect(allEmpty, '未登录用户读不到 task/submission/grading', `t=${t.data?.length ?? 0} s=${s.data?.length ?? 0} g=${g.data?.length ?? 0}`)
  }

  // 5) 前端伪造 role=admin 无效：修改自己 profile.role 为 admin 应被 RLS/策略约束，且即便改了也拿不到跨机构数据
  {
    // 尝试把自己升级为 admin
    const { error: upErr } = await s1.client.from('profiles').update({ role: 'admin' }).eq('id', s1.user.id).select('id')
    // 即使 profiles 允许改自己，仍不能借此读到 audit_logs（仅管理员且策略基于数据库真实判断）
    const audit = await s1.client.from('audit_logs').select('id').limit(1)
    // 恢复角色，避免污染
    await s1.client.from('profiles').update({ role: 'student' }).eq('id', s1.user.id)
    const stillBlocked = (audit.data?.length ?? 0) === 0
    expect(stillBlocked, '前端伪造 role=admin 仍无法获得管理员数据', `audit_logs 返回 ${audit.data?.length ?? 0} 条; profileUpd=${upErr?.code ?? 'ok'}`)
  }

  // 6) 正式提交后的 submission_version 不能被覆盖
  {
    const { data, error } = await s2.client.from('submission_versions').update({ text_answer: '篡改已提交版本' }).eq('id', s2ver.id).select('id')
    const blocked = (data?.length ?? 0) === 0
    expect(blocked, 'finalized 版本不可被覆盖', error ? error.message : `影响 ${data?.length ?? 0} 行`)
  }

  // 清理测试任务（教师删除 draft 之外的用归档；此处直接删任务级联）
  await teacher.client.from('tasks').delete().eq('id', task.id)

  section('RLS 结果')
  console.log(failures === 0 ? '✅ 六项越权测试全部符合预期' : `❌ 有 ${failures} 项不符合预期`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常:', e.message)
  process.exit(1)
})
