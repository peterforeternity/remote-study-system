import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { getStudentGradings } from '@/services/learning'
import {
  assessLearning,
  generateRecommendations,
  analyzeErrors,
} from '@/engine'
import { useAuthStore } from '@/store/useAuthStore'
import { TrendingUp, AlertTriangle, Lightbulb } from 'lucide-react'

export default function LearningPath() {
  const { profile } = useAuthStore()
  const gradings = useQuery({
    queryKey: ['student-gradings', profile?.id],
    queryFn: () => getStudentGradings(profile!.id),
    enabled: Boolean(profile?.id),
  })

  const list = gradings.data ?? []
  const assessment = assessLearning(list)
  const recommendations = generateRecommendations(assessment)
  const errorReport = analyzeErrors(list)

  return (
    <div>
      <PageHeader title="学习路径" subtitle="基于历史成绩与错误模式的个性化建议" />

      {gradings.isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-muted">
              暂无已批改的成绩数据。完成并被批改作业后，这里会生成学习评估与推荐。
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardBody>
              <h2 className="mb-3 flex items-center gap-2 font-display font-semibold">
                <TrendingUp size={18} className="text-primary" /> 综合进度
              </h2>
              <p className="font-display text-4xl font-semibold text-primary">
                {assessment.progressScore}
                <span className="text-base text-muted"> / 100</span>
              </p>
              <div className="mt-4 space-y-2">
                {Object.entries(assessment.competency).map(([subject, pct]) => (
                  <div key={subject}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{subject}</span>
                      <span className="text-muted">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-border">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="mb-3 flex items-center gap-2 font-display font-semibold">
                <AlertTriangle size={18} className="text-warning" /> 错误分析
              </h2>
              <p className="text-sm text-muted">共 {errorReport.total} 处标注，其中重大错误 {errorReport.majorCount} 处。</p>
              <ul className="mt-3 space-y-1 text-sm">
                {errorReport.topCategories.length === 0 ? (
                  <li className="text-muted">暂无高频错误</li>
                ) : (
                  errorReport.topCategories.map((c) => (
                    <li key={c.category} className="flex justify-between">
                      <span>{c.category}</span>
                      <span className="text-muted">{c.count} 次</span>
                    </li>
                  ))
                )}
              </ul>
              {assessment.weakAreas.length > 0 && (
                <p className="mt-3 text-sm">
                  薄弱科目：
                  <span className="text-danger">{assessment.weakAreas.join('、')}</span>
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="mb-3 flex items-center gap-2 font-display font-semibold">
                <Lightbulb size={18} className="text-accent" /> 推荐学习内容
              </h2>
              {recommendations.length === 0 ? (
                <p className="text-sm text-muted">表现优秀，暂无强化建议。</p>
              ) : (
                <ul className="space-y-3">
                  {recommendations.map((r) => (
                    <li key={r.title} className="rounded border border-border p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{r.title}</p>
                        <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                          优先级 {r.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{r.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
