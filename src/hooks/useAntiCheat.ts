import { useCallback, useEffect, useRef, useState } from 'react'
import { logSubmissionEvent } from '@/services/antiCheat'
import type { SubmissionEventType } from '@/types'

// ============================================================
// 防作弊监控 Hook：
//  - 切屏/窗口失焦（blur / visibilitychange）
//  - 禁止复制粘贴（copy / paste 拦截并记录）
//  - 全屏退出检测
// 触发的事件写入 submission_events（后端留痕），并累计违规次数供前端提示。
// enabled=false 时不监听（如已提交、非答题状态）。
// ============================================================

export interface AntiCheatState {
  violations: number
  lastEvent: SubmissionEventType | null
  requestFullscreen: () => void
  isFullscreen: boolean
}

export function useAntiCheat(params: {
  enabled: boolean
  submissionId?: string
  studentId?: string
  organizationId?: string
  containerRef?: React.RefObject<HTMLElement | null>
}): AntiCheatState {
  const { enabled, submissionId, studentId, organizationId, containerRef } = params
  const [violations, setViolations] = useState(0)
  const [lastEvent, setLastEvent] = useState<SubmissionEventType | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // 用 ref 保存最新参数，避免频繁重绑监听
  const ctx = useRef({ submissionId, studentId, organizationId })
  ctx.current = { submissionId, studentId, organizationId }

  const record = useCallback(
    (eventType: SubmissionEventType, detail?: Record<string, unknown>) => {
      setViolations((v) => v + 1)
      setLastEvent(eventType)
      const { submissionId: sid, studentId: uid, organizationId: oid } = ctx.current
      if (sid && uid && oid) {
        void logSubmissionEvent({
          submissionId: sid,
          studentId: uid,
          organizationId: oid,
          eventType,
          detail,
        })
      }
    },
    [],
  )

  useEffect(() => {
    if (!enabled) return

    const onBlur = () => record('blur')
    const onVisibility = () => {
      if (document.hidden) record('visibility_hidden')
    }
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault()
      record('copy_blocked')
    }
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      record('paste_blocked')
    }
    const onFullscreenChange = () => {
      const fs = Boolean(document.fullscreenElement)
      setIsFullscreen(fs)
      if (!fs) record('fullscreen_exit')
    }

    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', onFullscreenChange)

    const el = containerRef?.current ?? document
    el.addEventListener('copy', onCopy as EventListener)
    el.addEventListener('paste', onPaste as EventListener)

    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      el.removeEventListener('copy', onCopy as EventListener)
      el.removeEventListener('paste', onPaste as EventListener)
    }
  }, [enabled, record, containerRef])

  const requestFullscreen = useCallback(() => {
    const el = containerRef?.current ?? document.documentElement
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => {})
  }, [containerRef])

  return { violations, lastEvent, requestFullscreen, isFullscreen }
}
