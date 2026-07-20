-- ============================================================
-- 20260720000001_fix_task_resources_storage_rls.sql
-- 修复 task-resources 存储桶上传策略：auth.role() 返回的是 PostgreSQL 角色
-- (authenticated)，而非应用角色(teacher/admin)。改用 is_teacher() 函数。
-- ============================================================

drop policy if exists "task_resources upload" on storage.objects;
create policy "task_resources upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-resources'
    and (storage.foldername(name))[1] = auth_org_id()::text
    and is_teacher()
  );
