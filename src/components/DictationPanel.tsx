import { useState } from 'react'
import { Volume2, Mic, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  speak,
  recognizeOnce,
  isTTSSupported,
  isSpeechRecognitionSupported,
  isDictationCorrect,
} from '@/lib/speech'
import type { TaskQuestion } from '@/types'

// ============================================================
// 听写作答面板：
//  - 教师录入的听写内容（question.content）通过 TTS 朗读，不在界面显示原词。
//  - 学生可用语音识别口述，或直接打字作答。
//  - 自动与标准答案比对，即时给出对/错反馈。
// 学生每题作答结果以 JSON 汇总回传父组件，纳入文本提交。
// ============================================================

export interface DictationAnswer {
  questionId: string
  answer: string
  correct: boolean
}

export function DictationPanel({
  questions,
  disabled,
  onChange,
}: {
  questions: TaskQuestion[]
  disabled?: boolean
  onChange: (answers: DictationAnswer[]) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [listening, setListening] = useState<string | null>(null)
  const ttsOk = isTTSSupported()
  const srOk = isSpeechRecognitionSupported()

  const update = (q: TaskQuestion, value: string) => {
    const next = { ...answers, [q.id]: value }
    setAnswers(next)
    // 汇总所有听写题作答
    onChange(
      questions.map((qq) => {
        const a = next[qq.id] ?? ''
        return {
          questionId: qq.id,
          answer: a,
          correct: isDictationCorrect(qq.content, a),
        }
      }),
    )
  }

  const handleListen = async (q: TaskQuestion) => {
    setListening(q.id)
    try {
      const lang = /[\u4e00-\u9fa5]/.test(q.content) ? 'zh-CN' : 'en-US'
      const heard = await recognizeOnce(lang)
      update(q, heard)
    } catch {
      // 识别失败静默，学生可改用打字
    } finally {
      setListening(null)
    }
  }

  if (questions.length === 0) return null

  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const value = answers[q.id] ?? ''
        const correct = value ? isDictationCorrect(q.content, value) : null
        return (
          <div key={q.id} className="rounded border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">听写第 {i + 1} 题</span>
              <span className="text-xs text-muted">{q.score} 分</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => speak(q.content)}
                disabled={!ttsOk || disabled}
                title={ttsOk ? '播放听写内容' : '当前浏览器不支持语音朗读'}
              >
                <Volume2 size={16} /> 播放
              </Button>
              {srOk && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleListen(q)}
                  disabled={disabled || listening === q.id}
                >
                  <Mic size={16} /> {listening === q.id ? '识别中…' : '口述作答'}
                </Button>
              )}
              <input
                value={value}
                onChange={(e) => update(q, e.target.value)}
                disabled={disabled}
                placeholder="听后在此作答（或口述）"
                className="min-w-[10rem] flex-1 rounded border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-70"
              />
              {correct != null &&
                (correct ? (
                  <Check size={18} className="text-success" />
                ) : (
                  <X size={18} className="text-danger" />
                ))}
            </div>
          </div>
        )
      })}
      {!ttsOk && (
        <p className="text-xs text-danger">
          当前浏览器不支持语音朗读（TTS），请更换 Chrome/Edge 等浏览器。
        </p>
      )}
    </div>
  )
}
