-- ============================================================
-- 20260721000006_fix_storage_policy_array_length.sql
-- 修复 Storage INSERT/DELETE 策略中 array_length 错误。
--
-- 根因：storage.foldername(name) 去掉文件名后返回路径段数组。
-- 对于 8 段路径 {orgId}/students/{uid}/submissions/{subId}/versions/{verId}/{fileName}
→ foldername 返回 7 个元素。
-- 但策略写为 array_length = 8，导致所有上传被 RLS 拒绝。
-- ============================================================

-- 1. 修复 INSERT 策略
drop policy if exists submissions_insert on storage.objects;
create policy submissions_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'submissions'
  and array_length(storage.foldername(name), 1) = 7
  and (storage.foldername(name))[1] = (public.auth_org_id())::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = (auth.uid())::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and exists(
    select 1 from public.submissions s
    join public.submission_versions sv on sv.submission_id = s.id
    where s.id::text = (storage.foldername(name))[5]
      and sv.id::text = (storage.foldername(name))[7]
      and s.student_id = auth.uid()
      and s.organization_id = public.auth_org_id()
      and not sv.finalized
  )
);

-- 2. 修复 DELETE 策略
drop policy if exists submissions_delete on storage.objects;
create policy submissions_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'submissions'
  and array_length(storage.foldername(name), 1) = 7
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = (auth.uid())::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and exists(
    select 1 from public.submissions s
    join public.submission_versions sv on sv.submission_id = s.id
    where s.id::text = (storage.foldername(name))[5]
      and sv.id::text = (storage.foldername(name))[7]
      and s.student_id = auth.uid()
      and not sv.finalized
  )
);
