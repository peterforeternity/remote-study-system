import { create } from 'zustand'

// ============================================================
// 主题状态。主题偏好属非敏感 UI 偏好，允许存 localStorage。
// 通过 data-theme 属性驱动 CSS 变量切换，不触碰任何业务数据。
// ============================================================

export const THEMES = [
  { id: 'minimal-academy', name: '极简学院' },
  { id: 'deep-space', name: '深空夜读' },
  { id: 'warm-sunlight', name: '暖阳自习' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

const STORAGE_KEY = 'rss:theme'

function readInitialTheme(): ThemeId {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  }
  return 'minimal-academy'
}

export function applyTheme(theme: ThemeId) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

interface ThemeState {
  theme: ThemeId
  setTheme: (t: ThemeId) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: readInitialTheme(),
  setTheme: (t) => {
    applyTheme(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* 忽略持久化失败，不影响业务 */
    }
    set({ theme: t })
  },
}))
