-- ============================================================
-- 20260721000000_fix_task_resources_storage_rls.sql
-- 修复 task-resources 存储桶 RLS 策略，落实最小权限原则。
--
-- 路径约定: {organization_id}/tasks/{task_id}/resources/{uuid}-{filename}
-- 先删除再创建，避免与旧策略冲突。
-- ============================================================

-- 确保桶存在且为私有
insert into storage.buckets (id, name, public)
values ('task-resources', 'task-resources', false)
on conflict (id) do update set public = false;

-- 删除旧策略（来自 20260720000000 和 20260720000001）
-- 同时删除本迁移自身的策略名，保证幂等（重复执行不报错）
drop policy if exists "task_resources upload"   on storage.objects;
drop policy if exists "task_resources read"    on storage.objects;
drop policy if exists "task_resources select"  on storage.objects;
drop policy if exists "task_resources insert"  on storage.objects;
drop policy if exists "task_resources update"  on storage.objects;
drop policy if exists "task_resources delete"  on storage.objects;
drop policy if exists "task_resources_insert"  on storage.objects;
drop policy if exists "task_resources_select"  on storage.objects;
drop policy if exists "task_resources_update"  on storage.objects;
drop policy if exists "task_resources_delete"  on storage.objects;

-- -----------------------------------------------------------
-- INSERT: 仅任务管理者（创建者/管理员）可上传
-- -----------------------------------------------------------
create policy "task_resources_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'task-resources'
  and (storage.foldername(name))[1] = auth_org_id()::text
  and (storage.foldername(name))[2] = 'tasks'
  and (storage.foldername(name))[4] = 'resources'
  and exists (
    select 1
    from public.tasks t
    where t.id::text = (storage.foldername(name))[3]
      and t.organization_id = auth_org_id()
      and can_manage_task(t.id)
  )
);

-- -----------------------------------------------------------
-- SELECT: 仅有权查看任务的用户（创建者/分配到的学生/同机构管理员）
-- -----------------------------------------------------------
create policy "task_resources_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-resources'
  and exists (
    select 1
    from public.tasks t
    where t.id::text = (storage.foldername(name))[3]
      and t.organization_id = auth_org_id()
      and can_view_task(t.id)
  )
);

-- -----------------------------------------------------------
-- UPDATE: 仅任务管理者
-- -----------------------------------------------------------
create policy "task_resources_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'task-resources'
  and exists (
    select 1
    from public.tasks t
    where t.id::text = (storage.foldername(name))[3]
      and t.organization_id = auth_org_id()
      and can_manage_task(t.id)
  )
)
with check (
  bucket_id = 'task-resources'
  and exists (
    select 1
    from public.tasks t
    where t.id::text = (storage.foldername(name))[3]
      and t.organization_id = auth_org_id()
      and can_manage_task(t.id)
  )
);

-- -----------------------------------------------------------
-- DELETE: 仅任务管理者
-- -----------------------------------------------------------
create policy "task_resources_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'task-resources'
  and exists (
    select 1
    from public.tasks t
    where t.id::text = (storage.foldername(name))[3]
      and t.organization_id = auth_org_id()
      and can_manage_task(t.id)
  )
);
