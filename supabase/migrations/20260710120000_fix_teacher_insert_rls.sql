-- ============================================================
-- 20260710120000_fix_teacher_insert_rls.sql
-- 修复：云端缺失/非预期的 classes_insert 与 tasks_insert 策略，
--       导致教师 INSERT 被 RLS 拒绝。幂等重建两条 insert 策略与依赖函数。
--
-- 注意：本文件已部署到云端。后续对 SELECT 策略的补充修复见
--       20260710130000_fix_creator_select_rls.sql（新迁移，避免同名不重跑）。
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
