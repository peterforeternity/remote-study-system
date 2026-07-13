// ============================================================
// 浏览器语音能力封装：文字转语音（TTS）与语音识别（Web Speech API）。
// 均做特性检测，不支持时优雅降级（返回 false / 抛出可读错误）。
// ============================================================

/** 浏览器是否支持语音合成（朗读）。 */
export function isTTSSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 朗读一段文字。lang 默认根据内容猜测：含中文用 zh-CN，否则 en-US。 */
export function speak(text: string, lang?: string): void {
  if (!isTTSSupported()) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang ?? (/[\u4e00-\u9fa5]/.test(text) ? 'zh-CN' : 'en-US')
  u.rate = 0.9
  window.speechSynthesis.speak(u)
}

// SpeechRecognition 在不同浏览器下前缀不同
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance
interface SpeechRecognitionInstance {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** 浏览器是否支持语音识别。 */
export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null
}

/**
 * 识别一次语音，返回识别到的文本。
 * lang 默认按 expected 内容猜测语言。
 */
export function recognizeOnce(lang?: string): Promise<string> {
  const Ctor = getRecognitionCtor()
  if (!Ctor) return Promise.reject(new Error('当前浏览器不支持语音识别'))
  return new Promise((resolve, reject) => {
    const rec = new Ctor()
    rec.lang = lang ?? 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    let done = false
    rec.onresult = (e) => {
      done = true
      resolve(e.results[0]?.[0]?.transcript ?? '')
    }
    rec.onerror = (e) => reject(new Error(`语音识别失败：${e.error}`))
    rec.onend = () => {
      if (!done) resolve('')
    }
    rec.start()
  })
}

/** 归一化后比较听写答案：忽略大小写、首尾空白、末尾标点。 */
export function isDictationCorrect(expected: string, actual: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[.,!?;:'"。，！？；：]/g, '')
      .replace(/\s+/g, ' ')
  return norm(expected) === norm(actual)
}
