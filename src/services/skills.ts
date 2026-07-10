import { supabase } from '@/lib/supabase'
import type { SubjectSkillRow } from '@/types'

export async function listSkills(): Promise<SubjectSkillRow[]> {
  const { data, error } = await supabase
    .from('subject_skills')
    .select('*')
    .order('subject', { ascending: true })
  if (error) throw error
  return (data as SubjectSkillRow[]) ?? []
}

export async function toggleSkill(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('subject_skills')
    .update({ enabled })
    .eq('id', id)
  if (error) throw error
}
