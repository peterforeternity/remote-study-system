/**
 * scripts/e2e-cloud-flow.mjs
 * 真实教师—学生双账号云端闭环 + Realtime 事件验证。
 *
 * 运行：npm run test:cloud-flow
 * 依赖 .env：SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY（Realtime 需 anon key + 会话）
 *
 * 流程：教师建/发任务 → 学生读/建/草稿/正式提交 → 教师批改/发布 → 学生查看结果
 * 同时用独立订阅端断言 Realtime 收到 submissions / grading_sessions / notifications 事件。
 */
import {
  assertConfig,
  signInAs,
  ACCOUNTS,
  section,
  log,
  waitFor,
} from './_shared.mjs'

assertConfig()

const CLASS_ID = '00000000-0000-0000-0000-0000000000c1'
const stamp = Date.now()
let failures = 0
function check(cond, msg) {
  log(cond, msg)
  if (!cond) failures++
  return cond
}

async function main() {
  // ---------- 登录 ----------
  section('登录')
  const teacher = await signInAs(ACCOUNTS.teacher)
  const student = await signInAs(ACCOUNTS.student1)
  check(!!teacher.user, `教师登录 ${ACCOUNTS.teacher}`)
  check(!!student.user, `学生登录 ${ACCOUNTS.student1}`)

  const orgId = (
    await teacher.client.from('profiles').select('organization_id').eq('id', teacher.user.id).single()
  ).data.organization_id

  // ---------- Realtime 订阅端（学生视角订阅自己的作业 + 通知）----------
  section('建立 Realtime 订阅')
  const events = { submissions: [], grading: [], notifications: [] }
  let subTargetId = null

  const chan = student.client
    .channel(`e2e-student-${stamp}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, (p) => {
      events.submissions.push({ t: Date.now(), event: p.eventType, status: p.new?.status })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'grading_sessions' }, (p) => {
      events.grading.push({ t: Date.now(), event: p.eventType, status: p.new?.status })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, (p) => {
      events.notifications.push({ t: Date.now(), event: p.eventType, type: p.new?.type })
    })

  await new Promise((resolve, reject) => {
    chan.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`订阅失败: ${status}`))
    })
  })
  check(true, 'Realtime 频道 SUBSCRIBED')

  // ---------- 教师：创建并发布任务 ----------
  section('教师创建并发布任务')
  const title = `E2E自动化任务-${stamp}`
  const { data: task, error: taskErr } = await teacher.client
    .from('tasks')
    .insert({
      organization_id: orgId,
      creator_id: teacher.user.id,
      title,
      description: '自动化测试任务',
      subject: '数学',
      full_score: 100,
      status: 'draft',
    })
    .select('*')
    .single()
  check(!taskErr && !!task, `创建任务 (${taskErr?.message ?? 'ok'})`)
  const taskId = task.id

  await teacher.client.from('task_questions').insert([
    { task_id: taskId, order_no: 1, type: 'single', content: '1+1=? A.2 B.3', answer_key: 'A', score: 50 },
    { task_id: taskId, order_no: 2, type: 'subjective', content: '简述加法交换律', answer_key: null, score: 50 },
  ])
  await teacher.client.from('task_assignees').insert({ task_id: taskId, class_id: CLASS_ID })
  const { error: pubErr } = await teacher.client.from('tasks').update({ status: 'published' }).eq('id', taskId)
  check(!pubErr, `发布任务 (${pubErr?.message ?? 'ok'})`)
  console.log(`  task id = ${taskId}`)

  // ---------- 学生：读取新任务 ----------
  section('学生读取已分配任务')
  const { data: visTasks } = await student.client.from('tasks').select('id,title,status').eq('id', taskId)
  check(visTasks?.length === 1, `学生可见教师新发布任务 (${visTasks?.length ?? 0} 条)`)

  // ---------- 学生：创建 submission + 版本 + 草稿 + 正式提交 ----------
  section('学生创建作业并正式提交')
  const { data: sub, error: subErr } = await student.client
    .from('submissions')
    .insert({ task_id: taskId, student_id: student.user.id, organization_id: orgId, status: 'draft' })
    .select('*')
    .single()
  check(!subErr && !!sub, `创建 submission (${subErr?.message ?? 'ok'})`)
  const submissionId = sub.id
  subTargetId = submissionId
  console.log(`  submission id = ${submissionId}`)

  // 草稿版本（未 finalize）
  const { error: draftErr } = await student.client.from('submission_versions').insert({
    submission_id: submissionId, version_no: 1, text_answer: '草稿内容', finalized: false, created_by: student.user.id,
  })
  check(!draftErr, `保存草稿版本 (${draftErr?.message ?? 'ok'})`)

  // 正式提交：新建 finalized 版本 + 更新状态 submitted
  const { data: finalVer, error: finErr } = await student.client.from('submission_versions').insert({
    submission_id: submissionId, version_no: 2, text_answer: '加法交换律：a+b=b+a。答案选A。',
    finalized: true, finalized_at: new Date().toISOString(), created_by: student.user.id,
  }).select('*').single()
  check(!finErr && !!finalVer, `创建正式版本 (${finErr?.message ?? 'ok'})`)

  await student.client.from('submissions').update({ status: 'submitted', current_version_id: finalVer.id }).eq('id', submissionId)
  const { data: afterSubmit } = await student.client.from('submissions').select('status').eq('id', submissionId).single()
  check(afterSubmit?.status === 'submitted', `作业状态为 submitted (实际: ${afterSubmit?.status})`)

  // ---------- 教师：读取提交并批改 ----------
  section('教师批改')
  const { data: teacherView } = await teacher.client.from('submissions').select('id,status,student_id').eq('id', submissionId)
  check(teacherView?.length === 1, `教师可读取学生 submission (${teacherView?.length ?? 0} 条)`)

  const { data: grading, error: gErr } = await teacher.client
    .from('grading_sessions')
    .insert({ submission_id: submissionId, organization_id: orgId, grader_id: teacher.user.id, status: 'draft' })
    .select('*')
    .single()
  check(!gErr && !!grading, `创建 grading_session (${gErr?.message ?? 'ok'})`)

  await teacher.client.from('submissions').update({ status: 'grading' }).eq('id', submissionId)
  const { error: scoreErr } = await teacher.client
    .from('grading_sessions')
    .update({ score: 92, comment: '答案正确，推导清晰。', status: 'finalized', graded_at: new Date().toISOString(), version: grading.version + 1 })
    .eq('id', grading.id)
    .eq('version', grading.version)
  check(!scoreErr, `打分+发布批改（乐观锁）(${scoreErr?.message ?? 'ok'})`)

  await teacher.client.from('submissions').update({ status: 'graded' }).eq('id', submissionId)
  // 通知先落库
  await teacher.client.from('notifications').insert({
    recipient_id: student.user.id, organization_id: orgId, type: 'grading.finalized',
    title: `《${title}》已批改完成`, payload: { submissionId },
  })

  // ---------- 学生：查看结果 ----------
  section('学生查看批改结果')
  const { data: finalSub } = await student.client.from('submissions').select('status').eq('id', submissionId).single()
  check(finalSub?.status === 'graded', `作业最终状态 graded (实际: ${finalSub?.status})`)

  const { data: g2 } = await student.client.from('grading_sessions').select('score,comment').eq('submission_id', submissionId).single()
  check(g2?.score === 92, `学生可读取分数 (${g2?.score})`)
  check(!!g2?.comment, `学生可读取评语 (${g2?.comment ?? '无'})`)

  const { data: notif } = await student.client.from('notifications').select('type,title').eq('recipient_id', student.user.id).eq('type', 'grading.finalized')
  check((notif?.length ?? 0) >= 1, `notifications 生成通知 (${notif?.length ?? 0} 条)`)

  // ---------- Realtime 断言 ----------
  section('Realtime 事件断言')
  await waitFor(() => events.submissions.some((e) => e.status === 'graded'), 8000)
  const gotSubGraded = events.submissions.some((e) => e.status === 'graded')
  const gotGrading = events.grading.length > 0
  const gotNotif = events.notifications.some((e) => e.type === 'grading.finalized')
  check(events.submissions.length > 0, `收到 submissions 事件 (${events.submissions.length} 次)`)
  check(gotSubGraded, `submissions 事件含 graded 状态`)
  check(gotGrading, `收到 grading_sessions 事件 (${events.grading.length} 次)`)
  check(gotNotif, `收到 notifications 事件 (${events.notifications.length} 次)`)
  console.log('  事件明细:', JSON.stringify(events))
  void subTargetId

  await student.client.removeChannel(chan)

  // ---------- 汇总 ----------
  section('结果汇总')
  console.log(`task_id=${taskId}`)
  console.log(`submission_id=${submissionId}`)
  console.log(`final_status=graded, score=92`)
  console.log(failures === 0 ? '\n✅ 云端闭环全部通过' : `\n❌ 有 ${failures} 项失败`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常:', e.message)
  process.exit(1)
})
