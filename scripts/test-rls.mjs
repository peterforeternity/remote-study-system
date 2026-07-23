/**
 * scripts/test-rls.mjs
 * RLS 越权测试。用真实登录会话验证行级安全，记录每项的 HTTP/错误结果。
 *
 * 运行：npm run test:rls
 * 依赖 .env：SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
 *   （service-role 项需 SUPABASE_SECRET_KEY；缺失时该项跳过并提示）
 *
 * 前置：需存在种子数据（npm run seed:users）。脚本会临时用 student2 造一份提交作为越权目标。
 */
import { createClient } from '@supabase/supabase-js'
import { assertConfig, signInAs, anonClient, ACCOUNTS, section, log, CFG } from './_shared.mjs'

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
  let taskId = null
  try {

  // 准备：教师建一个已发布任务；student2 创建一份 submission 作为越权目标
  const { data: task } = await teacher.client.from('tasks').insert({
    organization_id: orgId, creator_id: teacher.user.id, title: `[E2E] RLS测试任务-${Date.now()}`,
    description: '', subject: '数学', full_score: 100, status: 'published',
  }).select('*').single()
  taskId = task.id
  await teacher.client.from('task_assignees').insert({ task_id: task.id, class_id: CLASS_ID })

  const { data: s2sub } = await s2.client.from('submissions').insert({
    task_id: task.id, student_id: s2.user.id, organization_id: orgId, status: 'draft',
  }).select('*').single()
  const { data: curSub } = await s2.client.from('submissions').select('version').eq('id', s2sub.id).single()
  const expectedVer = curSub?.version ?? 0
  const { data: dr } = await s2.client.rpc('create_submission_draft_version', { p_submission_id: s2sub.id })
  const draftVer = Array.isArray(dr) ? dr[0] : dr
  await s2.client.rpc('finalize_submission', {
    p_submission_id: s2sub.id, p_version_id: draftVer.id, p_expected_version: expectedVer,
  })
  const { data: s2subFinal } = await s2.client.from('submissions').select('*').eq('id', s2sub.id).single()
  const s2ver = { id: s2subFinal.current_version_id }

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

  // 5) profiles 敏感字段提权防护（列级权限 + 触发器）
  {
    // 5.1 student1 改自己的 role 为 admin：必须失败
    const r1 = await s1.client.from('profiles').update({ role: 'admin' }).eq('id', s1.user.id).select('id')
    expect(!!r1.error, 'student1 修改自己 role→admin 被拒', r1.error ? `${r1.error.code}: ${r1.error.message}` : `竟成功 影响 ${r1.data?.length ?? 0} 行`)

    // 5.2 student1 改自己的 organization_id：必须失败
    const r2 = await s1.client.from('profiles').update({ organization_id: '00000000-0000-0000-0000-0000000000ab' }).eq('id', s1.user.id).select('id')
    expect(!!r2.error, 'student1 修改自己 organization_id 被拒', r2.error ? `${r2.error.code}: ${r2.error.message}` : `竟成功 影响 ${r2.data?.length ?? 0} 行`)

    // 5.3 student1 改自己的 id：必须失败
    const r3 = await s1.client.from('profiles').update({ id: '00000000-0000-0000-0000-0000000000ff' }).eq('id', s1.user.id).select('id')
    expect(!!r3.error, 'student1 修改自己 id 被拒', r3.error ? `${r3.error.code}: ${r3.error.message}` : `竟成功 影响 ${r3.data?.length ?? 0} 行`)

    // 5.4 student1 改自己的 email：必须失败
    const r4 = await s1.client.from('profiles').update({ email: 'hacker@example.com' }).eq('id', s1.user.id).select('id')
    expect(!!r4.error, 'student1 修改自己 email 被拒', r4.error ? `${r4.error.code}: ${r4.error.message}` : `竟成功 影响 ${r4.data?.length ?? 0} 行`)

    // 5.5 student1 改允许字段 name：必须成功
    const newName = `王同学-${Date.now()}`
    const r5 = await s1.client.from('profiles').update({ name: newName }).eq('id', s1.user.id).select('name').single()
    expect(!r5.error && r5.data?.name === newName, 'student1 修改自己 name 成功', r5.error ? r5.error.message : `name=${r5.data?.name}`)

    // 5.6 修改失败后 is_admin() 必须仍为 false
    const adm = await s1.client.rpc('is_admin')
    expect(adm.data === false, '提权失败后 is_admin() 仍为 false', `is_admin=${adm.data}`)

    // 5.7 student1 读取管理员数据（audit_logs）必须继续失败
    const audit = await s1.client.from('audit_logs').select('id').limit(1)
    expect((audit.data?.length ?? 0) === 0, 'student1 读不到管理员数据 audit_logs', `返回 ${audit.data?.length ?? 0} 条`)

    // 5.8 service-role 管理修改测试用户 role：应成功（用 student2 作为受控测试对象）
    if (CFG.secret) {
      const admin = createClient(CFG.url, CFG.secret, { auth: { persistSession: false, autoRefreshToken: false } })
      const up = await admin.from('profiles').update({ role: 'teacher' }).eq('id', s2.user.id).select('role').single()
      const ok = !up.error && up.data?.role === 'teacher'
      // 恢复 student2 角色
      await admin.from('profiles').update({ role: 'student' }).eq('id', s2.user.id)
      expect(ok, 'service-role 可修改用户 role', up.error ? up.error.message : `role=${up.data?.role}（已恢复）`)
    } else {
      log(true, 'service-role role 修改（跳过：未配置 SUPABASE_SECRET_KEY）')
    }

    // 5.9 确保 student1 role 仍为 student（读取自身校验）
    const self = await s1.client.from('profiles').select('role').eq('id', s1.user.id).single()
    expect(self.data?.role === 'student', 'student1 的 role 仍为 student', `role=${self.data?.role}`)
  }

  // 6) 正式提交后的 submission_version 不能被覆盖
  {
    const { data, error } = await s2.client.from('submission_versions').update({ text_answer: '篡改已提交版本' }).eq('id', s2ver.id).select('id')
    const blocked = (data?.length ?? 0) === 0
    expect(blocked, 'finalized 版本不可被覆盖', error ? error.message : `影响 ${data?.length ?? 0} 行`)
  }

  // 清理测试任务（try/finally，失败也执行）
  } finally {
    // published 任务受 tasks_delete(status='draft') 限制，教师无法删除；
    // 用 service-role 兜底清理本次及遗留的 [E2E] 任务（级联删除 submission/version）。
    if (CFG.secret && taskId) {
      const admin = createClient(CFG.url, CFG.secret, { auth: { persistSession: false, autoRefreshToken: false } })
      await admin.from('tasks').delete().eq('id', taskId)
      await admin.from('tasks').delete().like('title', '[E2E]%')
    } else if (!CFG.secret) {
      log(true, '未配置 SUPABASE_SECRET_KEY：跳过 service-role 清理（可运行 npm run cleanup:e2e）')
    }
  }

  section('RLS 结果')
  console.log(failures === 0 ? '✅ 所有越权/提权测试全部符合预期' : `❌ 有 ${failures} 项不符合预期`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常:', e.message)
  process.exit(1)
})
