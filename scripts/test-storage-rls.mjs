/**
 * Storage task-resources RLS 权限测试脚本。
 *
 * 测试范围（全部使用 anon key + 用户登录，不通过 service_role 绕过 RLS）：
 *   1. 教师可以向自己管理的任务上传。
 *   2. 教师不能向其他机构任务上传。
 *   3. 学生不能上传任务资源。
 *   4. 已分配学生可以读取任务资源。
 *   5. 未分配学生不能读取任务资源。
 *   6. 匿名用户不能读取资源。
 *   7. 教师可以删除自己任务的资源。
 *   8. 学生不能删除资源。
 *   9. 私有桶的公开 URL 无法直接访问。
 *  10. 签名 URL 在有效期内可以访问。
 *
 * 用法：node --env-file=.env scripts/test-storage-rls.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('缺少 SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY')
  process.exit(1)
}

const PASSWORD = 'Passw0rd!'
const ORG_ID = '00000000-0000-0000-0000-0000000000aa'
const TASK_ID = '00000000-0000-0000-0000-0000000000d1'
const TEST_PATH = `${ORG_ID}/tasks/${TASK_ID}/resources/test-rls-perm.txt`
const fileContent = new Blob([`test-${Date.now()}`], { type: 'text/plain' })

const ACCOUNTS = {
  teacher: 'teacher@example.com',
  student1: 'student1@example.com',
  student2: 'student2@example.com',
  admin: 'admin@example.com',
}

let pass = 0
let fail = 0

function log(ok, msg) {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}`) }
}

function section(title) {
  console.log(`\n=== ${title} ===`)
}

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`登录 ${email} 失败: ${error.message}`)
  return { client, user: data.user }
}

async function cleanupAll(client, paths) {
  for (const p of paths) {
    try { await client.storage.from('task-resources').remove([p]) } catch (_) { /* ok */ }
  }
}

// ============================================================
async function main() {
  console.log('Storage RLS 权限测试\n')

  // ---- 测试 1: 教师可以向自己管理的任务上传 ----
  section('1. 教师向自己管理的任务上传')
  try {
    const { client } = await signIn(ACCOUNTS.teacher)
    const { error } = await client.storage.from('task-resources').upload(TEST_PATH, fileContent)
    log(!error, error ? `上传被拒: ${error.message}` : `上传成功`)
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 2: 教师向其他机构任务上传（不应成功） ----
  section('2. 教师向其他机构任务上传（应被拒绝）')
  try {
    const { client } = await signIn(ACCOUNTS.teacher)
    const otherPath = `ffffffff-ffff-ffff-ffff-ffffffffffff/tasks/${TASK_ID}/resources/evil.txt`
    const { error } = await client.storage.from('task-resources').upload(otherPath, fileContent)
    log(!!error, error ? `正确拒绝: ${error.message}` : '不应成功但上传了！')
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 3: 学生不能上传任务资源 ----
  section('3. 学生不能上传任务资源')
  try {
    const { client } = await signIn(ACCOUNTS.student1)
    const sp = `${ORG_ID}/tasks/${TASK_ID}/resources/student-ev.txt`
    const { error } = await client.storage.from('task-resources').upload(sp, fileContent)
    log(!!error, error ? `正确拒绝: ${error.message}` : '不应成功但上传了！')
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 4: 已分配学生可以读取任务资源 (createSignedUrl) ----
  section('4. 已分配学生可以读取任务资源（签名 URL）')
  try {
    const { client } = await signIn(ACCOUNTS.student1)
    const { data, error } = await client.storage.from('task-resources').createSignedUrl(TEST_PATH, 60)
    log(!error && !!data?.signedUrl, error ? `被拒: ${error.message}` : `签名 URL 生成成功`)
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 5: 未分配学生不能读取任务资源 ----
  // student2 和 student1 同属 初二(3)班，示例任务也分配给该班级，
  // can_view_task() 正确通过 class_members 返回 true。
  // 为准确地测试，创建临时任务仅分配给只含 student1 的临时班级。
  section('5. 未分配学生不能读取任务资源')
  try {
    const tmpClassId = '00000000-0000-0000-0000-000000000ca5'
    const tmpTaskId  = '00000000-0000-0000-0000-0000000000ca'
    const tmpPath = `${ORG_ID}/tasks/${tmpTaskId}/resources/tmp-perm.txt`
    const { client: tc } = await signIn(ACCOUNTS.teacher)

    // 幂等地创建临时班级（只含 student1），临时任务
    await tc.from('classes').upsert({
      id: tmpClassId, organization_id: ORG_ID, name: '存储测试临时班',
      created_by: (await tc.auth.getUser()).data.user.id,
    }, { onConflict: 'id' }).then(r => { if (r.error) console.warn('  [setup] 班级:', r.error.message) })
    await tc.from('class_members').upsert({
      class_id: tmpClassId, profile_id: (await signIn(ACCOUNTS.student1)).user.id,
      role_in_class: 'student',
    }, { onConflict: 'class_id,profile_id' }).then(r => { if (r.error) console.warn('  [setup] 成员:', r.error.message) })
    await tc.from('tasks').upsert({
      id: tmpTaskId, organization_id: ORG_ID, title: '存储测试临时任务',
      subject: 'test', status: 'published', creator_id: (await tc.auth.getUser()).data.user.id,
    }, { onConflict: 'id' }).then(r => { if (r.error) console.warn('  [setup] 任务:', r.error.message) })
    await tc.from('task_assignees').upsert({
      task_id: tmpTaskId, class_id: tmpClassId,
    }, { onConflict: 'task_id,class_id' }).then(r => { if (r.error) console.warn('  [setup] 分配:', r.error.message) })

    // 上传测试文件
    await tc.storage.from('task-resources').upload(tmpPath, fileContent)

    // student2 不应能读取（不在临时班）
    const { client: s2c } = await signIn(ACCOUNTS.student2)
    const { error } = await s2c.storage.from('task-resources').createSignedUrl(tmpPath, 60)
    log(!!error, error ? `正确拒绝: ${error.message}` : '不应成功但生成了签名 URL')

    // 清理临时数据
    await cleanupAll(tc, [tmpPath])
    await tc.from('task_assignees').delete().eq('task_id', tmpTaskId)
    await tc.from('class_members').delete().eq('class_id', tmpClassId)
    await tc.from('tasks').delete().eq('id', tmpTaskId)
    await tc.from('classes').delete().eq('id', tmpClassId)
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 6: 匿名用户不能读取资源 ----
  section('6. 匿名用户不能读取资源')
  try {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { error } = await anonClient.storage.from('task-resources').createSignedUrl(TEST_PATH, 60)
    log(!!error, error ? `正确拒绝: ${error.message}` : '不应成功但生成了签名 URL')
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 7: 教师可以删除自己任务的资源（先上传再删除，确保对象存在） ----
  section('7. 教师可以删除自己任务的资源（先上传再删）')
  const delPath = `${ORG_ID}/tasks/${TASK_ID}/resources/test-del-by-teacher.txt`
  try {
    const { client } = await signIn(ACCOUNTS.teacher)
    await client.storage.from('task-resources').upload(delPath, fileContent)
    const { error } = await client.storage.from('task-resources').remove([delPath])
    log(!error, error ? `删除被拒: ${error.message}` : `删除成功`)
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 8: 学生不能删除资源（重新上传一个对象再让学生试删） ----
  section('8. 学生不能删除资源')
  const stuDelPath = `${ORG_ID}/tasks/${TASK_ID}/resources/test-del-by-stu.txt`
  try {
    // 教师上传
    const { client: tc } = await signIn(ACCOUNTS.teacher)
    const { error: upErr } = await tc.storage.from('task-resources').upload(stuDelPath, fileContent)
    if (upErr) { log(false, `前置上传失败: ${upErr.message}`); }
    else {
      // 学生尝试删除
      const { client: sc } = await signIn(ACCOUNTS.student1)
      const { error: delErr } = await sc.storage.from('task-resources').remove([stuDelPath])
      // 删除后验证文件是否真的被删了：用教师重读确认
      const { data: checkData } = await tc.storage.from('task-resources').createSignedUrl(stuDelPath, 60)
      const wasDeleted = !checkData?.signedUrl // 教师也读不到 = 真的被删了
      const rejected = !!delErr || !wasDeleted // 报错 或 文件没被删 = RLS 生效
      log(rejected,
        delErr ? `正确拒绝: ${delErr.message}`
        : !wasDeleted ? '正确：文件未被删除（RLS 拦截）'
        : '不应成功但确实删除了！')
      if (wasDeleted && !delErr) {
        // RLS 没有拦住，学生成功删了 — 这是安全漏洞
        console.warn('  ⚠ RLS 策略未生效，学生删除了教师文件！')
      }
      // 确保清理
      await cleanupAll(tc, [stuDelPath, delPath])
    }
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 9: 私有桶的公开 URL 无法访问 ----
  section('9. 私有桶的公开 URL 无法直接访问')
  try {
    const { client } = await signIn(ACCOUNTS.teacher)
    const { data: urlData } = client.storage.from('task-resources').getPublicUrl(TEST_PATH)
    const resp = await fetch(urlData.publicUrl)
    log(resp.status >= 400 && resp.status < 500,
      `公开 URL 返回 ${resp.status}（预期 4xx）`)
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 测试 10: 签名 URL 在有效期内可以访问 ----
  section('10. 签名 URL 在有效期内可以访问')
  try {
    const { client } = await signIn(ACCOUNTS.teacher)
    const { data } = await client.storage.from('task-resources').createSignedUrl(TEST_PATH, 120)
    if (!data?.signedUrl) {
      log(false, '无法生成签名 URL')
    } else {
      const resp = await fetch(data.signedUrl)
      log(resp.ok, resp.ok ? `HTTP ${resp.status} 成功获取内容` : `HTTP ${resp.status} 失败`)
    }
  } catch (e) {
    log(false, `异常: ${e.message}`)
  }

  // ---- 清理 ----
  console.log('\n清理测试文件…')
  try {
    const { client } = await signIn(ACCOUNTS.teacher)
    const { data: listData } = await client.storage.from('task-resources').list(`${ORG_ID}/tasks/${TASK_ID}/resources`, { limit: 100 })
    if (listData) {
      const names = listData.filter(f => f.name.startsWith('test-')).map(f => `${ORG_ID}/tasks/${TASK_ID}/resources/${f.name}`)
      if (names.length) await client.storage.from('task-resources').remove(names)
    }
    console.log('清理完成')
  } catch (e) {
    console.log('清理: 跳过或失败')
  }

  // ---- 总结 ----
  console.log(`\n${'='.repeat(40)}`)
  console.log(`通过 ${pass} / ${pass + fail} (${fail} 项失败)`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('测试异常:', e.message)
  process.exit(1)
})
