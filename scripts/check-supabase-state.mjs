import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
)

// 1. 桶状态
console.log('=== Storage Bucket ===')
const { data: buckets } = await admin.storage.listBuckets()
const tr = buckets?.find((b) => b.name === 'task-resources')
if (tr) {
  console.log(`name: ${tr.name}`)
  console.log(`public: ${tr.public}`)
  console.log(`limit: ${(tr.file_size_limit ?? 0) / 1024 / 1024}MiB`)
} else {
  console.log('桶不存在！')
}

// 2. RLS 策略（通过 pg_policies 表）
console.log('\n=== Storage Policies ===')
const { data: raw, error: polErr } = await admin
  .from('pg_policies')
  .select('policyname,cmd')
  .eq('schemaname', 'storage')
  .eq('tablename', 'objects')
  .like('policyname', 'task_resources%')

if (polErr) {
  console.log(`查询策略出错: ${polErr.message}`)
} else {
  console.log(raw?.map((p) => `  ${p.policyname} (${p.cmd})`).join('\n') || '  无 task_resources 策略')
}

// 3. 迁移状态
console.log('\n=== Migration Status ===')
const mr = await fetch(
  `${process.env.SUPABASE_URL}/rest/v1/schema_migrations?version=eq.20260721000000&select=version`,
  {
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    },
  },
)
const migrations = await mr.json()
console.log(migrations.length > 0
  ? `  已部署: ${migrations[0].version}`
  : '  迁移 20260721000000 尚未部署（等待 Supabase GitHub Integration）')

// 4. 深层文件
console.log('\n=== Storage Files ===')
const { data: root } = await admin.storage
  .from('task-resources')
  .list('00000000-0000-0000-0000-0000000000aa', { sortBy: { column: 'name', order: 'asc' } })
console.log(`  根目录 (${root?.length ?? 0} 项):`, root?.map((f) => f.name))

// 递归检查子目录
const testFiles = []
async function walk(prefix) {
  const { data } = await admin.storage.from('task-resources').list(prefix)
  if (!data?.length) return
  for (const item of data) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    if (!item.metadata) {
      // 是文件
      if (item.name.includes('test')) testFiles.push(path)
    } else {
      await walk(path)
    }
  }
}
await walk('00000000-0000-0000-0000-0000000000aa')
if (testFiles.length) {
  console.log(`  发现测试文件: ${testFiles.join(', ')}`)
}
