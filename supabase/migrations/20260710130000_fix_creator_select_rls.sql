-- ============================================================
-- 20260710130000_fix_creator_select_rls.sql
-- 修复：教师创建 classes / tasks 时，前端 .insert().select() 触发
--       `INSERT ... RETURNING`，要求新行同时通过 SELECT 策略；而
--       classes_select 缺 created_by 分支、tasks_select 依赖的
--       can_view_task() 在云端无 creator 分支，导致新建行在 RETURNING
--       阶段不可见，误报 "new row violates row-level security policy"。
--
--       实证：不带 RETURNING 的插入返回 201 成功；带 RETURNING 被拒。
--
-- 说明：单独建新迁移（而非改已部署的 20260710120000），因为迁移系统
--       不会重跑同名文件。
--
-- 原则：不关闭 RLS；不使用 with check (true)；权限由数据库判断；幂等。
-- ============================================================

-- ---------- 修复 classes_select：补充"创建者本人可见" ----------
drop policy if exists classes_select on classes;
create policy classes_select on classes for select to authenticated
  using (
    organization_id = auth_org_id()
    and (is_admin() or created_by = auth.uid() or teaches_class(id) or in_class(id))
  );

-- ---------- 修复 tasks_select：显式补充"创建者本人可见" ----------
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using (creator_id = auth.uid() or can_view_task(id));
