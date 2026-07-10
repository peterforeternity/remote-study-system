/**
 * 脚本共享工具。密钥只从服务端环境变量读取，绝不写入代码或日志。
 */
import { createClient } from '@supabase/supabase-js'

export const CFG = {
  url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  secret: process.env.SUPABASE_SECRET_KEY,
}

export const PASSWORD = 'Passw0rd!'
export const ACCOUNTS = {
  teacher: 'teacher@example.com',
  student1: 'student1@example.com',
  student2: 'student2@example.com',
  admin: 'admin@example.com',
}

export function assertConfig({ needSecret = false } = {}) {
  if (!CFG.url || !CFG.anon) {
    console.error('缺少 SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY。')
    process.exit(1)
  }
  if (needSecret && !CFG.secret) {
    console.error('缺少 SUPABASE_SECRET_KEY（service_role）。')
    process.exit(1)
  }
}

/** 每个用户独立客户端（携带各自会话，令 RLS 生效）。使用 anon key。 */
export function anonClient() {
  return createClient(CFG.url, CFG.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** 以指定账号登录，返回已鉴权的客户端与 user。 */
export async function signInAs(email) {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  })
  if (error) throw new Error(`登录失败 ${email}: ${error.message}`)
  return { client, user: data.user }
}

export function log(ok, msg) {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
}

export function section(title) {
  console.log(`\n=== ${title} ===`)
}

/** 等待条件成立或超时，用于 Realtime 事件断言。 */
export function waitFor(predicate, timeoutMs = 8000, intervalMs = 150) {
  return new Promise((resolve) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (predicate() || Date.now() - start > timeoutMs) {
        clearInterval(timer)
        resolve(predicate())
      }
    }, intervalMs)
  })
}
