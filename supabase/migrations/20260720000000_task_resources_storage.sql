-- ============================================================
-- 20260720000000_task_resources_storage.sql
-- 任务资源存储桶。教师可上传教学资料，学生只能读取。
-- 路径约定：{organization_id}/tasks/{task_id}/resources/{filename}
-- ============================================================

insert into storage.buckets (id, name, public)
values ('task-resources', 'task-resources', false)
on conflict (id) do nothing;

-- 上传：教师/管理员
drop policy if exists "task_resources upload" on storage.objects;
create policy "task_resources upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-resources'
    and (storage.foldername(name))[1] = auth_org_id()::text
    and auth.role() in ('teacher', 'admin')
  );

-- 读取：本机构所有成员
drop policy if exists "task_resources read" on storage.objects;
create policy "task_resources read" on storage.objects for select to authenticated
  using (
    bucket_id = 'task-resources'
    and (storage.foldername(name))[1] = auth_org_id()::text
  );
