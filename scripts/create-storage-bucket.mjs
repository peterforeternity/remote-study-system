/**
 * 手动创建 task-resources 存储桶。
 * 用法：node --env-file=.env scripts/create-storage-bucket.mjs
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY。')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  // 创建存储桶（ignore duplicate）
  const { data, error } = await admin.storage.createBucket('task-resources', {
    public: false,
    fileSizeLimit: 52428800, // 50MB
  })
  if (error) {
    if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
      console.log('✓ task-resources 桶已存在')
    } else {
      throw error
    }
  } else {
    console.log('✓ task-resources 桶已创建:', data)
  }
}

main().catch((e) => {
  console.error('失败:', e.message)
  process.exit(1)
})
