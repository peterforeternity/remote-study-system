-- ============================================================
-- 彻底清理 Storage 策略并重建
-- 旧策略名与 00002 中的 drop 不匹配，导致旧策略残留
-- ============================================================

-- 删除所有旧的 submissions 存储策略
drop policy if exists "submissions student upload" on storage.objects;
drop policy if exists "submissions student read" on storage.objects;
drop policy if exists "submissions teacher read" on storage.objects;
drop policy if exists "submissions delete" on storage.objects;
drop policy if exists "submissions student delete" on storage.objects;
drop policy if exists "submissions upload" on storage.objects;
drop policy if exists "submissions read" on storage.objects;
drop policy if exists "submissions update" on storage.objects;
drop policy if exists submissions_insert on storage.objects;
drop policy if exists submissions_select on storage.objects;
drop policy if exists submissions_delete on storage.objects;

-- 重建：仅 INSERT / SELECT / DELETE，无 UPDATE
-- 所有路径段和函数调用使用 schema 限定

-- 学生上传（只能上传到自己的未 finalize draft）
create policy submissions_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'submissions'
  and array_length(storage.foldername(name), 1) = 8
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

-- 学生/教师读取
create policy submissions_select on storage.objects
for select to authenticated
using (
  bucket_id = 'submissions'
  and array_length(storage.foldername(name), 1) >= 7
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and exists(
    select 1 from public.submissions s
    join public.submission_versions sv on sv.submission_id = s.id
    where s.id::text = (storage.foldername(name))[5]
      and sv.id::text = (storage.foldername(name))[7]
      and (
        s.student_id = auth.uid()
        or public.can_manage_task(s.task_id)
      )
  )
);

-- 学生删除（只能删自己未 finalize 的 draft 文件）
create policy submissions_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'submissions'
  and array_length(storage.foldername(name), 1) = 8
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
