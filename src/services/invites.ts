import { supabase } from '@/lib/supabase'
import type { InviteCode } from '@/types'

// ============================================================
// 邀请码服务（教师/管理员使用）。
// 邀请码用于学生自助注册时加入对应机构，角色由后端触发器强制为学生。
// ============================================================

/** 生成一个易读的随机邀请码（大写字母+数字，去除易混字符）。 */
function genCode(len = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  const arr = new Uint32Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length]
  return s
}

export async function listInviteCodes(): Promise<InviteCode[]> {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as InviteCode[]) ?? []
}

export async function createInviteCode(params: {
  organizationId: string
  createdBy: string
  maxUses?: number | null
  expiresAt?: string | null
}): Promise<InviteCode> {
  const { data, error } = await supabase
    .from('invite_codes')
    .insert({
      code: genCode(),
      organization_id: params.organizationId,
      created_by: params.createdBy,
      max_uses: params.maxUses ?? null,
      expires_at: params.expiresAt ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as InviteCode
}

/** 停用邀请码。 */
export async function deactivateInviteCode(id: string): Promise<void> {
  const { error } = await supabase
    .from('invite_codes')
    .update({ active: false })
    .eq('id', id)
  if (error) throw error
}
