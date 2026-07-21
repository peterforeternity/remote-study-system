import { supabase } from '@/lib/supabase'
import type { Class, ClassMember, Profile } from '@/types'

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

/** 获取同机构所有学生（用于添加班级成员）。 */
export async function listOrgStudents(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .order('name')
  if (error) throw error
  return (data as Profile[]) ?? []
}

/** 获取某班级所有成员（含 profile 信息）。 */
export async function listClassMembers(classId: string): Promise<(ClassMember & { profiles: Profile })[]> {
  const { data, error } = await supabase
    .from('class_members')
    .select('*, profiles:profile_id(*)')
    .eq('class_id', classId)
  if (error) throw error
  return (data as any[]) ?? []
}

/** 添加学生到班级。 */
export async function addClassMember(params: {
  classId: string
  studentId: string
}): Promise<ClassMember> {
  const { data, error } = await supabase
    .from('class_members')
    .insert({
      class_id: params.classId,
      profile_id: params.studentId,
      role_in_class: 'student',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ClassMember
}

/** 从班级移除成员。 */
export async function removeClassMember(memberId: string): Promise<void> {
  const { error } = await supabase
    .from('class_members')
    .delete()
    .eq('id', memberId)
  if (error) throw error
}
