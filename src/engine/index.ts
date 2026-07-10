// ============================================================
// 领域引擎：客观题验证 / 主观题初评 / 错误分析 / 学习评估。
// 纯函数，便于单元测试；AI Worker 与前端预览均可复用。
// 第一阶段使用明确的规则算法（不依赖外部模型），LLM 为可选增强。
// ============================================================

import type {
  TaskQuestion,
  ErrorCategory,
  Grading,
} from './engineTypes'

export interface VerificationResult {
  questionId: string
  type: 'objective' | 'subjective'
  correct?: boolean
  score: number
  confidence: number
  feedback: string
}

const OBJECTIVE_TYPES = new Set(['single', 'multiple', 'judge', 'blank', 'numeric'])

/** 规范化答案：去空白、统一大小写、排序多选。 */
function normalize(answer: string): string {
  return answer.trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeMulti(answer: string): string {
  return normalize(answer).split(/[,，、;；]?/).sort().join('')
}

/**
 * 客观题自动评分。
 * @param q 题目（含 answer_key）
 * @param answer 学生作答
 */
export function scoreObjective(
  q: Pick<TaskQuestion, 'id' | 'type' | 'answer_key' | 'score'>,
  answer: string,
): VerificationResult {
  const key = q.answer_key ?? ''
  let correct = false
  if (q.type === 'numeric') {
    const a = parseFloat(answer)
    const k = parseFloat(key)
    // 数值题允许 1e-6 容差
    correct = !Number.isNaN(a) && !Number.isNaN(k) && Math.abs(a - k) < 1e-6
  } else if (q.type === 'multiple') {
    correct = normalizeMulti(answer) === normalizeMulti(key)
  } else {
    correct = normalize(answer) === normalize(key)
  }
  return {
    questionId: q.id,
    type: 'objective',
    correct,
    score: correct ? q.score : 0,
    confidence: 1,
    feedback: correct ? '回答正确' : `参考答案：${key}`,
  }
}

/**
 * 主观题初步评估（规则版）：基于作答长度与关键词覆盖给出建议分与反馈。
 * 真实场景由 AI Worker 通过 LLM 增强，这里提供确定性基线。
 */
export function assessSubjective(
  q: Pick<TaskQuestion, 'id' | 'content' | 'score'>,
  answer: string,
  keywords: string[] = [],
): VerificationResult {
  const text = answer.trim()
  const len = text.length
  const hitKeywords = keywords.filter((k) => text.includes(k))
  const coverage = keywords.length > 0 ? hitKeywords.length / keywords.length : 0

  // 长度与关键词各占权重的基线评分
  const lengthScore = Math.min(1, len / 80)
  const ratio = keywords.length > 0 ? 0.6 * coverage + 0.4 * lengthScore : lengthScore
  const suggested = Math.round(q.score * ratio)

  let feedback = ''
  if (len === 0) feedback = '未作答，建议补充答案。'
  else if (coverage >= 0.8) feedback = '要点覆盖较全面，表达清晰。'
  else if (coverage >= 0.4) feedback = `已覆盖部分要点，建议补充：${keywords.filter((k) => !text.includes(k)).join('、')}`
  else feedback = '要点覆盖不足，建议围绕题目核心概念展开。'

  return {
    questionId: q.id,
    type: 'subjective',
    score: suggested,
    confidence: keywords.length > 0 ? 0.5 + 0.3 * coverage : 0.4,
    feedback,
  }
}

/** 根据题目类型分派验证。 */
export function verifyQuestion(
  q: Pick<TaskQuestion, 'id' | 'type' | 'content' | 'answer_key' | 'score'>,
  answer: string,
  keywords: string[] = [],
): VerificationResult {
  if (OBJECTIVE_TYPES.has(q.type)) {
    return scoreObjective(q, answer)
  }
  return assessSubjective(q, answer, keywords)
}

// ---------------- 错误分析 ----------------

export interface ErrorReport {
  total: number
  byCategory: Record<ErrorCategory, number>
  majorCount: number
  topCategories: { category: ErrorCategory; count: number }[]
}

const ALL_CATEGORIES: ErrorCategory[] = [
  'concept', 'calculation', 'logic', 'expression',
  'careless', 'incomplete', 'format', 'misunderstanding',
]

/** 汇总批改中的错误标注，生成错误统计报告。 */
export function analyzeErrors(gradings: Grading[]): ErrorReport {
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, 0]),
  ) as Record<ErrorCategory, number>
  let total = 0
  let majorCount = 0

  for (const g of gradings) {
    for (const a of g.annotations) {
      total += 1
      if (a.errorCategory && a.errorCategory in byCategory) {
        byCategory[a.errorCategory] += 1
      }
      if (a.severity === 'major' || a.severity === 'critical') majorCount += 1
    }
  }

  const topCategories = ALL_CATEGORIES
    .map((category) => ({ category, count: byCategory[category] }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  return { total, byCategory, majorCount, topCategories }
}

// ---------------- 学习评估 ----------------

export interface LearningAssessment {
  competency: Record<string, number>
  progressScore: number
  weakAreas: string[]
  masteredAreas: string[]
}

export interface Recommendation {
  title: string
  reason: string
  priority: number
  subject: string
}

/**
 * 学习评估（规则版）：按科目聚合历史得分率，输出能力维度与薄弱项。
 */
export function assessLearning(gradings: Grading[]): LearningAssessment {
  const bySubject: Record<string, { got: number; full: number }> = {}
  for (const g of gradings) {
    const s = g.subject || '综合'
    if (!bySubject[s]) bySubject[s] = { got: 0, full: 0 }
    bySubject[s].got += g.score ?? 0
    bySubject[s].full += g.fullScore || 0
  }

  const competency: Record<string, number> = {}
  const weakAreas: string[] = []
  const masteredAreas: string[] = []
  let sumRatio = 0
  let n = 0

  for (const [subject, v] of Object.entries(bySubject)) {
    const ratio = v.full > 0 ? v.got / v.full : 0
    const pct = Math.round(ratio * 100)
    competency[subject] = pct
    sumRatio += ratio
    n += 1
    if (pct < 60) weakAreas.push(subject)
    else if (pct >= 85) masteredAreas.push(subject)
  }

  const progressScore = n > 0 ? Math.round((sumRatio / n) * 100) : 0
  return { competency, progressScore, weakAreas, masteredAreas }
}

/** 依据评估生成个性化推荐（规则版）。 */
export function generateRecommendations(
  assessment: LearningAssessment,
): Recommendation[] {
  const recs: Recommendation[] = []
  const sorted = Object.entries(assessment.competency).sort((a, b) => a[1] - b[1])
  sorted.forEach(([subject, pct], idx) => {
    if (pct < 85) {
      recs.push({
        title: `${subject}强化训练`,
        reason: `当前${subject}掌握度约 ${pct}%，建议针对性巩固。`,
        priority: sorted.length - idx,
        subject,
      })
    }
  })
  return recs
}
