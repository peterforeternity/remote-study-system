-- ============================================================
-- 20260710150000_dictation_and_anticheat.sql
-- 1) 新增听写题型 question_type = 'dictation'
--    听写题：content 存要朗读的词/句，answer_key 存标准答案（学生听后作答，自动比对）。
-- 2) 新增作弊行为日志表 submission_events：
--    记录切屏/失焦/粘贴/全屏退出等事件，供教师批改时参考。
--    学生只能写入自己作业的事件；教师可读其可管理任务下的事件。
-- 幂等：枚举值/表/策略均可重复部署。
-- ============================================================

-- ---------- 1. 听写题型 ----------
-- 注意：ALTER TYPE ... ADD VALUE 不能置于 DO/PL-pgSQL 块内执行。
alter type question_type add value if not exists 'dictation';

-- ---------- 2. 防作弊行为日志表 ----------
create table if not exists submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  event_type text not null,          -- blur / focus / visibility_hidden / paste_blocked / fullscreen_exit / copy_blocked
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_submission_events_submission
  on submission_events (submission_id, created_at);

alter table submission_events enable row level security;

-- 学生插入：仅能为自己的作业写事件，且机构一致
drop policy if exists submission_events_insert on submission_events;
create policy submission_events_insert on submission_events for insert to authenticated
  with check (
    student_id = auth.uid()
    and organization_id = auth_org_id()
    and exists (
      select 1 from submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

-- 读取：学生看自己的；教师看其可管理任务下作业的事件
drop policy if exists submission_events_select on submission_events;
create policy submission_events_select on submission_events for select to authenticated
  using (
    student_id = auth.uid()
    or exists (
      select 1 from submissions s
      where s.id = submission_id and can_manage_task(s.task_id)
    )
  );

-- 事件为只读审计，不允许更新/删除（无对应策略即默认拒绝）。
