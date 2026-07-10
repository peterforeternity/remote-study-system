-- ============================================================
-- 20260710120000_fix_teacher_insert_rls.sql
-- 修复：教师创建 classes / tasks 时，虽然 INSERT 的 WITH CHECK 合法，
--       但 `INSERT ... RETURNING`（前端 .insert().select()）要求新行同时
--       通过 SELECT 策略；而 classes_select / tasks_select 未包含
--       "创建者本人可见"，导致新建行在 RETURNING 阶段不可见，
--       报 "new row violates row-level security policy"。
--
--       实证：不带 RETURNING 的插入返回 201 成功；带 RETURNING 被拒。
--       因此需为 SELECT 策略补充 creator 可见分支。
--
-- 原则（与 20260710110100_rls_policies.sql 保持一致）：
--   * 不关闭 RLS。
--   * 不使用 with check (true)。
--   * 权限一律由数据库函数判断，前端传入 role 无效。
--   * 幂等：可重复执行。
-- ============================================================

-- ---------- 幂等重建辅助函数（防止云端为旧版本）----------
create or replace function auth_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid();
$$;

create or replace function is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('teacher','admin') from profiles where id = auth.uid()), false);
$$;

-- ---------- 确保 RLS 已启用（幂等）----------
alter table classes enable row level security;
alter table tasks enable row level security;

-- ---------- 重建 classes_insert ----------
drop policy if exists classes_insert on classes;
create policy classes_insert on classes for insert to authenticated
  with check (
    organization_id = auth_org_id()
    and is_teacher()
    and created_by = auth.uid()
  );

-- ---------- 重建 tasks_insert ----------
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated
  with check (
    is_teacher()
    and organization_id = auth_org_id()
    and creator_id = auth.uid()
  );

-- ---------- 修复 classes_select：补充"创建者本人可见" ----------
-- 使 INSERT ... RETURNING 能返回教师刚创建、尚无 class_members 的班级行。
drop policy if exists classes_select on classes;
create policy classes_select on classes for select to authenticated
  using (
    organization_id = auth_org_id()
    and (is_admin() or created_by = auth.uid() or teaches_class(id) or in_class(id))
  );

-- ---------- 修复 tasks_select：显式补充"创建者本人可见" ----------
-- 云端 can_view_task() 可能为旧版本，未含 creator 分支；此处在策略层显式加入，
-- 使教师创建任务后的 INSERT ... RETURNING 能返回新行。
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using (creator_id = auth.uid() or can_view_task(id));
