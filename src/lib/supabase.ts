import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseEnv, isSupabaseConfigured } from './env'

// ============================================================
// Supabase 客户端单例。
// 仅使用可发布密钥（publishable / anon key），行级安全(RLS)在数据库侧强制。
// 若未配置环境变量，导出一个占位客户端并由 isSupabaseConfigured 提示用户。
// ============================================================

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      supabaseEnv.url || 'http://localhost:54321',
      supabaseEnv.publishableKey || 'public-anon-placeholder',
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    )
  }
  return client
}

export const supabase = getSupabase()

export { isSupabaseConfigured }
