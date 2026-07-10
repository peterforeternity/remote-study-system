// ============================================================
// 前端环境变量读取（仅公开变量，均以 VITE_ 前缀暴露）
// 服务端密钥（SUPABASE_SECRET_KEY / AI_API_KEY 等）绝不在此读取。
// ============================================================

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

export const supabaseEnv = {
  url: url ?? '',
  publishableKey: publishableKey ?? '',
}

/** 是否已完成 Supabase 连接配置。未配置时前端给出明确提示，而非静默降级。 */
export const isSupabaseConfigured = Boolean(url && publishableKey)
