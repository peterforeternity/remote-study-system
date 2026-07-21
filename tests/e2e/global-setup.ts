import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Playwright 全局设置：加载 .env 文件中的环境变量，
 * 使测试代码可访问 SUPABASE_URL / SUPABASE_SECRET_KEY 等。
 */
async function globalSetup() {
  try {
    const envPath = resolve(process.cwd(), '.env')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
    console.log('[global-setup] .env loaded')
  } catch {
    console.log('[global-setup] .env not found, assuming env vars are already set')
  }
}

export default globalSetup
