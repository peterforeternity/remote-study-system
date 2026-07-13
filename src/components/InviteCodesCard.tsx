import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Ticket, Plus, Copy, Check, Ban } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  listInviteCodes,
  createInviteCode,
  deactivateInviteCode,
} from '@/services/invites'
import { useAuthStore } from '@/store/useAuthStore'

// ============================================================
// 教师/管理员：邀请码管理。学生凭邀请码注册并加入本机构。
// ============================================================

export function InviteCodesCard() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const [copied, setCopied] = useState<string | null>(null)

  const codes = useQuery({ queryKey: ['invite-codes'], queryFn: listInviteCodes })

  const create = useMutation({
    mutationFn: () =>
      createInviteCode({
        organizationId: profile!.organization_id,
        createdBy: profile!.id,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invite-codes'] }),
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => deactivateInviteCode(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invite-codes'] }),
  })

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display font-semibold">
            <Ticket size={18} /> 邀请码
          </h2>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus size={16} /> 生成邀请码
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted">
          将邀请码发给学生，学生在注册页填入即可加入本机构（角色固定为学生）。
        </p>

        {codes.isLoading ? (
          <p className="text-sm text-muted">加载中…</p>
        ) : (codes.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">暂无邀请码，点击上方按钮生成。</p>
        ) : (
          <ul className="space-y-2">
            {codes.data!.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded border border-border px-3 py-2"
              >
                <div>
                  <span
                    className={
                      c.active
                        ? 'font-mono text-sm font-semibold tracking-widest'
                        : 'font-mono text-sm tracking-widest text-muted line-through'
                    }
                  >
                    {c.code}
                  </span>
                  <span className="ml-2 text-xs text-muted">
                    已使用 {c.used_count}
                    {c.max_uses ? `/${c.max_uses}` : ''} 次
                    {c.active ? '' : ' · 已停用'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => copy(c.code)}
                    className="rounded p-1.5 text-muted hover:bg-bg hover:text-fg"
                    title="复制"
                  >
                    {copied === c.code ? (
                      <Check size={15} className="text-success" />
                    ) : (
                      <Copy size={15} />
                    )}
                  </button>
                  {c.active && (
                    <button
                      onClick={() => deactivate.mutate(c.id)}
                      className="rounded p-1.5 text-muted hover:bg-bg hover:text-danger"
                      title="停用"
                    >
                      <Ban size={15} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
