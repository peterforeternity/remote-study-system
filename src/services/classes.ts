import { supabase } from '@/lib/supabase'
import type { Class } from '@/types'

// ============================================================
// 班级服务
// ============================================================

export async function listMyClasses(): Promise<Class[]> {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Class[]) ?? []
}

export async function createClass(params: {
  organizationId: string
  name: string
  createdBy: string
}): Promise<Class> {
  const { data, error } = await supabase
    .from('classes')
    .insert({
      organization_id: params.organizationId,
      name: params.name,
      created_by: params.createdBy,
    })
    .select('*')
    .single()
  if (error) throw error
  const cls = data as Class
  // 创建者作为教师加入班级成员，便于 RLS 判定授课关系
  await supabase.from('class_members').insert({
    class_id: cls.id,
    profile_id: params.createdBy,
    role_in_class: 'teacher',
  })
  return cls
}
