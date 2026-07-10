// 领域引擎使用的精简类型（与数据库类型解耦，便于纯函数测试）。
import type { QuestionType, ErrorCategory, ErrorSeverity } from '@/types'

export type { QuestionType, ErrorCategory, ErrorSeverity }

export interface TaskQuestion {
  id: string
  type: QuestionType
  content: string
  answer_key: string | null
  score: number
}

export interface GradingAnnotation {
  severity: ErrorSeverity
  errorCategory: ErrorCategory | null
}

export interface Grading {
  score: number | null
  fullScore: number
  subject: string
  annotations: GradingAnnotation[]
}
