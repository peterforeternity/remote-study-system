-- ============================================================
-- 20260710110200_storage.sql
-- 私有对象存储桶 + Storage RLS 策略。
-- 作业文件路径约定：
--   {organization_id}/tasks/{task_id}/submissions/{submission_id}/versions/{version_id}/{file}
-- 学生只能读写自己的作业目录；教师可读其可管理作业的目录。
-- ============================================================

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

-- 上传：路径首段（organization_id）必须等于当前用户机构，且第二段为 'tasks'
drop policy if exists "submissions upload" on storage.objects;
create policy "submissions upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth_org_id()::text
  );

-- 读取：本机构成员均可通过签名 URL / 直接读取（细粒度归属校验在应用层结合 submission_files RLS 完成）
drop policy if exists "submissions read" on storage.objects;
create policy "submissions read" on storage.objects for select to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth_org_id()::text
  );

drop policy if exists "submissions update" on storage.objects;
create policy "submissions update" on storage.objects for update to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth_org_id()::text
    and owner = auth.uid()
  );
