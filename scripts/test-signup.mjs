/**
 * 注册链路验证脚本（test:signup）。
 *
 * 覆盖后端注册触发器 handle_new_user 的安全逻辑：
 *  1. 教师登录后为本机构生成邀请码。
 *  2. 有效邀请码注册 → 触发器自动建 profile，角色=student、机构正确。
 *  3. 无效邀请码注册 → 触发器抛异常，账号创建被回滚（无可用账号）。
 *  4. 提权尝试：元数据塞 role=admin → 最终 profile 仍为 student。
 *  5. 邀请码 used_count 随成功注册递增。
 *  6. 清理本次创建的用户、profile、邀请码。
 *
 * 说明：注册通过 Admin API 插入 auth.users 完成（同样触发 on_auth_user_created），
 * 以此绕开云端对 @example.com 测试域名的邮箱格式校验，专注验证触发器逻辑。
 *
 * 用法：node --env-file=.env scripts/test-signup.mjs
 * 密钥仅从环境变量读取，绝不写入代码或日志。
 */
import { createClient } from '@supabase/supabase-js'
import { CFG, PASSWORD, ACCOUNTS, assertConfig, signInAs, log, section } from './_shared.mjs'

assertConfig({ needSecret: true })

const admin = createClient(CFG.url, CFG.secret, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const stamp = Date.now()
const NEW_STUDENT = `signup-test-${stamp}@example.com`
const BAD_STUDENT = `signup-bad-${stamp}@example.com`
const ESCALATION_STUDENT = `signup-esc-${stamp}@example.com`
let inviteId = null
let inviteCode = null
const createdUserIds = []
let failures = 0

function check(ok, msg) {
  log(ok, msg)
  if (!ok) failures++
}

/**
 * 通过 Admin API 创建用户（触发 on_auth_user_created）。
 * 返回 { id, error }。成功建 profile 时 id 有值；触发器抛异常时 error 有值。
 */
async function registerWithMeta(email, code, extraMeta = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: '注册测试同学', invite_code: code, ...extraMeta },
  })
  const id = data?.user?.id ?? null
  if (id) createdUserIds.push(id)
  return { id, error }
}

async function main() {
  // ---------- 1. 教师生成邀请码 ----------
  section('1. 教师生成邀请码')
  const { client: teacherClient, user: teacher } = await signInAs(ACCOUNTS.teacher)
  const { data: prof } = await teacherClient
    .from('profiles')
    .select('organization_id')
    .eq('id', teacher.id)
    .single()
  const orgId = prof.organization_id

  const { data: invite, error: invErr } = await teacherClient
    .from('invite_codes')
    .insert({
      code: `TEST${stamp.toString().slice(-6)}`,
      organization_id: orgId,
      created_by: teacher.id,
      max_uses: 5,
    })
    .select('*')
    .single()
  check(!invErr && Boolean(invite), `教师生成邀请码${invErr ? ` 失败: ${invErr.message}` : ` ${invite.code}`}`)
  if (!invite) return
  inviteId = invite.id
  inviteCode = invite.code

  // ---------- 2. 有效邀请码注册 ----------
  section('2. 有效邀请码注册新学生')
  const { id: newId, error: regErr } = await registerWithMeta(NEW_STUDENT, inviteCode)
  check(!regErr && Boolean(newId), `注册${regErr ? ` 失败: ${regErr.message}` : '成功'}`)

  const { data: newProfile } = await admin
    .from('profiles')
    .select('role, organization_id')
    .eq('id', newId)
    .maybeSingle()
  check(Boolean(newProfile), '触发器自动创建了 profile')
  check(newProfile?.role === 'student', `profile 角色为 student（实际: ${newProfile?.role}）`)
  check(newProfile?.organization_id === orgId, 'profile 机构与邀请码机构一致')

  // ---------- 3. 无效邀请码注册 ----------
  section('3. 无效邀请码注册应被拒绝')
  const { id: badId, error: badErr } = await registerWithMeta(BAD_STUDENT, 'INVALIDXX')
  check(Boolean(badErr), `无效邀请码被拒绝${badErr ? `（${badErr.message}）` : '——但竟然成功了！'}`)
  if (badId) {
    const { data: badProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', badId)
      .maybeSingle()
    check(!badProfile, '无效邀请码未生成 profile')
  } else {
    check(true, '无效邀请码未创建任何账号（触发器回滚）')
  }

  // ---------- 4. 提权尝试 ----------
  section('4. 注册时伪造 role=admin 应无效')
  const { id: escId, error: escErr } = await registerWithMeta(ESCALATION_STUDENT, inviteCode, { role: 'admin' })
  check(!escErr && Boolean(escId), `提权注册处理${escErr ? ` 失败: ${escErr.message}` : '完成'}`)
  const { data: escProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', escId)
    .maybeSingle()
  check(escProfile?.role === 'student', `伪造 admin 无效，实际角色: ${escProfile?.role}`)

  // ---------- 5. used_count 递增 ----------
  section('5. 邀请码使用次数递增')
  const { data: usedInvite } = await admin
    .from('invite_codes')
    .select('used_count')
    .eq('id', inviteId)
    .single()
  check(usedInvite?.used_count === 2, `used_count = ${usedInvite?.used_count}（预期 2：有效注册 + 提权注册各 1 次）`)
}

async function cleanup() {
  section('清理测试数据')
  for (const id of createdUserIds) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  if (inviteId) await admin.from('invite_codes').delete().eq('id', inviteId)
  log(true, `已清理 ${createdUserIds.length} 个测试用户及邀请码`)
}

main()
  .catch((e) => {
    console.error('脚本异常:', e.message)
    failures++
  })
  .finally(async () => {
    await cleanup()
    console.log(`\n${failures === 0 ? '✓ 全部通过' : `✗ ${failures} 项失败`}`)
    process.exit(failures === 0 ? 0 : 1)
  })
