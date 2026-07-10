import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types'

// ============================================================
// 认证状态：会话 + 当前用户 profile（含服务端权威角色）。
// 前端的 role 仅用于界面展示与导航，一切权限判断以数据库 RLS 为准。
// ============================================================

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  initialized: boolean
  init: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (params: {
    email: string
    password: string
    name: string
    role: 'teacher' | 'student'
    organizationId: string
  }) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('加载 profile 失败:', error.message)
    return null
  }
  return (data as Profile) ?? null
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: false,
  initialized: false,

  init: async () => {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    let profile: Profile | null = null
    if (session?.user) {
      profile = await loadProfile(session.user.id)
    }
    set({ session, profile, initialized: true })

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      const nextProfile = newSession?.user
        ? await loadProfile(newSession.user.id)
        : null
      set({ session: newSession, profile: nextProfile })
    })
  },

  signIn: async (email, password) => {
    set({ loading: true })
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      const { data } = await supabase.auth.getSession()
      const profile = data.session?.user
        ? await loadProfile(data.session.user.id)
        : null
      set({ session: data.session, profile })
    } finally {
      set({ loading: false })
    }
  },

  signUp: async ({ email, password, name, role, organizationId }) => {
    set({ loading: true })
    try {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
      const user = data.user
      if (user) {
        // 创建对应 profile（RLS 要求 id = auth.uid()）
        const { error: pErr } = await supabase.from('profiles').insert({
          id: user.id,
          organization_id: organizationId,
          name,
          role,
          email,
        })
        if (pErr) throw pErr
      }
      // 若开启邮箱确认，此处 session 可能为空，需用户确认后再登录
      const { data: sess } = await supabase.auth.getSession()
      const profile = sess.session?.user
        ? await loadProfile(sess.session.user.id)
        : null
      set({ session: sess.session, profile })
    } finally {
      set({ loading: false })
    }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, profile: null })
  },

  refreshProfile: async () => {
    const session = get().session
    if (session?.user) {
      const profile = await loadProfile(session.user.id)
      set({ profile })
    }
  },
}))
