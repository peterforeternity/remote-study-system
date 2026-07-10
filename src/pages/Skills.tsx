import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { listSkills, toggleSkill } from '@/services/skills'
import { Blocks } from 'lucide-react'

export default function Skills() {
  const qc = useQueryClient()
  const skills = useQuery({ queryKey: ['skills'], queryFn: listSkills })
  const toggle = useMutation({
    mutationFn: (p: { id: string; enabled: boolean }) => toggleSkill(p.id, p.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  })

  // 按科目分组
  const grouped = (skills.data ?? []).reduce<Record<string, typeof skills.data>>(
    (acc, s) => {
      ;(acc[s.subject] ||= []).push(s)
      return acc
    },
    {},
  )

  return (
    <div>
      <PageHeader title="科目技能中心" subtitle="可扩展的 SKILL 框架：按科目管理评分与反馈能力" />

      {skills.isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : Object.keys(grouped).length === 0 ? (
        <p className="text-sm text-muted">暂无科目技能。</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(grouped).map(([subject, list]) => (
            <Card key={subject}>
              <CardBody>
                <h2 className="mb-3 flex items-center gap-2 font-display font-semibold">
                  <Blocks size={18} className="text-primary" /> {subject}
                </h2>
                <ul className="space-y-2">
                  {(list ?? []).map((s) => (
                    <li key={s.id} className="flex items-center justify-between rounded border border-border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-muted">v{s.version}</p>
                      </div>
                      <label className="inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={s.enabled}
                          onChange={(e) => toggle.mutate({ id: s.id, enabled: e.target.checked })}
                        />
                        <span className="h-5 w-9 rounded-full bg-border transition-colors peer-checked:bg-primary relative after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
                      </label>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
