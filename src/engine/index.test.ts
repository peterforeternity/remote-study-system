import { describe, it, expect } from 'vitest'
import {
  scoreObjective,
  assessSubjective,
  verifyQuestion,
  analyzeErrors,
  assessLearning,
  generateRecommendations,
} from './index'
import type { Grading } from './engineTypes'

describe('客观题评分 scoreObjective', () => {
  it('单选题正确得满分', () => {
    const r = scoreObjective({ id: 'q1', type: 'single', answer_key: 'A', score: 40 }, ' a ')
    expect(r.correct).toBe(true)
    expect(r.score).toBe(40)
  })

  it('单选题错误得 0 分并给出参考答案', () => {
    const r = scoreObjective({ id: 'q1', type: 'single', answer_key: 'A', score: 40 }, 'B')
    expect(r.correct).toBe(false)
    expect(r.score).toBe(0)
    expect(r.feedback).toContain('A')
  })

  it('多选题忽略顺序与分隔符', () => {
    const r = scoreObjective({ id: 'q2', type: 'multiple', answer_key: 'A,C', score: 10 }, 'C、A')
    expect(r.correct).toBe(true)
  })

  it('数值题在容差内判正确', () => {
    const r = scoreObjective({ id: 'q3', type: 'numeric', answer_key: '3.14', score: 5 }, '3.140000')
    expect(r.correct).toBe(true)
  })
})

describe('主观题初评 assessSubjective', () => {
  it('未作答给 0 分', () => {
    const r = assessSubjective({ id: 'q', content: '', score: 60 }, '   ')
    expect(r.score).toBe(0)
    expect(r.type).toBe('subjective')
  })

  it('覆盖关键词越多建议分越高', () => {
    const low = assessSubjective({ id: 'q', content: '', score: 60 }, '简单回答', ['求根公式', '判别式'])
    const high = assessSubjective(
      { id: 'q', content: '', score: 60 },
      '利用求根公式可解方程，判别式决定根的个数，展开详细推导过程说明。',
      ['求根公式', '判别式'],
    )
    expect(high.score).toBeGreaterThan(low.score)
  })
})

describe('verifyQuestion 分派', () => {
  it('客观题走客观评分', () => {
    const r = verifyQuestion({ id: 'q', type: 'judge', content: '', answer_key: '对', score: 10 }, '对')
    expect(r.type).toBe('objective')
    expect(r.correct).toBe(true)
  })
  it('主观题走主观评估', () => {
    const r = verifyQuestion({ id: 'q', type: 'subjective', content: '', answer_key: null, score: 10 }, '答案')
    expect(r.type).toBe('subjective')
  })
})

describe('错误分析 analyzeErrors', () => {
  it('统计分类与重大错误数', () => {
    const gradings: Grading[] = [
      {
        score: 50, fullScore: 100, subject: '数学',
        annotations: [
          { severity: 'major', errorCategory: 'calculation' },
          { severity: 'minor', errorCategory: 'careless' },
          { severity: 'critical', errorCategory: 'calculation' },
        ],
      },
    ]
    const report = analyzeErrors(gradings)
    expect(report.total).toBe(3)
    expect(report.majorCount).toBe(2)
    expect(report.byCategory.calculation).toBe(2)
    expect(report.topCategories[0].category).toBe('calculation')
  })
})

describe('学习评估与推荐', () => {
  it('低得分率科目进入薄弱项并生成推荐', () => {
    const gradings: Grading[] = [
      { score: 40, fullScore: 100, subject: '数学', annotations: [] },
      { score: 90, fullScore: 100, subject: '英语', annotations: [] },
    ]
    const a = assessLearning(gradings)
    expect(a.competency['数学']).toBe(40)
    expect(a.competency['英语']).toBe(90)
    expect(a.weakAreas).toContain('数学')
    expect(a.masteredAreas).toContain('英语')

    const recs = generateRecommendations(a)
    expect(recs.some((r) => r.subject === '数学')).toBe(true)
    // 已掌握的英语不应出现在推荐
    expect(recs.some((r) => r.subject === '英语')).toBe(false)
  })
})
