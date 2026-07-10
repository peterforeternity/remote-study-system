/**
 * scripts/cleanup-e2e.mjs
 * 独立清理脚本：删除所有 [E2E] 前缀的测试任务（级联删除 submission/version/grading）
 * 及对应通知。仅本地运行，使用 service-role（从环境变量读取，绝不写入代码或日志）。
 *
 * 运行：npm run cleanup:e2e
 * 依赖 .env：SUPABASE_URL / SUPABASE_SECRET_KEY
 *
 * 安全：仅删除 title 以 [E2E] 开头的任务与含 [E2E] 的通知，绝不触碰种子/真实业务数据。
 */
import { createClient } from '@supabase/supabase-js'
import { CFG, assertConfig, section, log } from './_shared.mjs'

assertConfig({ needSecret: true })

const admin = createClient(CFG.url, CFG.secret, {
  auth: { persistSession: false, autoRefreshToken: false },
})

section('清理 [E2E] 测试数据')

const tasks = await admin.from('tasks').delete().like('title', '[E2E]%').select('id')
log(!tasks.error, `删除 [E2E] 任务及级联数据 (${tasks.error?.message ?? `${tasks.data?.length ?? 0} 行`})`)

const notifs = await admin.from('notifications').delete().like('title', '%[E2E]%').select('id')
log(!notifs.error, `删除 [E2E] 通知 (${notifs.error?.message ?? `${notifs.data?.length ?? 0} 行`})`)

console.log('\n清理完成。')
process.exit(tasks.error || notifs.error ? 1 : 0)
