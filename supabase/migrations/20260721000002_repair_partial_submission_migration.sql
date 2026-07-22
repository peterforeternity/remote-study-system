-- ============================================================
-- 20260721000002_repair_partial_submission_migration.sql
-- 修复 20260721000001 因 search_path='' 未限定 schema 导致的半迁移状态。
--
-- 问题：set search_path = '' 下未限定 schema 的对象引用（submissions 等）
-- 导致 RPC 创建失败、Storage 策略未执行、migration 历史无记录。
--
-- 本 migration 幂等重建所有对象，全部使用 public. 前缀。
-- ============================================================

-- ============================================================
-- 1. 修复 submissions UPDATE 保护触发器
-- ============================================================

drop trigger if exists trg_submissions_update_protected on public.submissions;

create or replace function public.check_submissions_update_protected()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- RPC 调用时设置了 bypass 标记，跳过保护
  if nullif(current_setting('app.submission_workflow_rpc', true), '') = '1' then
    return new;
  end if;

  -- 教师通过 grading 函数仍可更新（批改流程暂未全部迁移至 RPC）
  -- 必须校验 can_grade_submission 而非 is_teacher()
  if public.can_grade_submission(old.id) then
    return new;
  end if;

  raise exception 'Direct UPDATE on submissions is forbidden. Use the RPC API (finalize_submission etc.).';
end;
$$;

create trigger trg_submissions_update_protected
  before update on public.submissions
  for each row execute function public.check_submissions_update_protected();

-- ============================================================
-- 2. 修复 submission_versions 保护触发器
-- ============================================================

drop trigger if exists trg_submission_versions_update_protected on public.submission_versions;

create or replace function public.check_submission_versions_update_protected()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if nullif(current_setting('app.submission_workflow_rpc', true), '') = '1' then
    return new;
  end if;

  if old.finalized then
    raise exception 'Finalized versions are immutable.';
  end if;

  if new.finalized and not old.finalized then
    raise exception 'Cannot set finalized=true directly. Use RPC finalize_submission.';
  end if;

  if new.submission_id <> old.submission_id then
    raise exception 'submission_id is immutable.';
  end if;
  if new.version_no <> old.version_no then
    raise exception 'version_no is immutable.';
  end if;
  if new.finalized_at <> old.finalized_at and old.finalized_at is not null then
    raise exception 'finalized_at is immutable once set.';
  end if;
  if new.created_by <> old.created_by then
    raise exception 'created_by is immutable.';
  end if;
  if new.created_at <> old.created_at then
    raise exception 'created_at is immutable.';
  end if;

  return new;
end;
$$;

create trigger trg_submission_versions_update_protected
  before update on public.submission_versions
  for each row execute function public.check_submission_versions_update_protected();

drop trigger if exists trg_submission_versions_insert_protected on public.submission_versions;

create or replace function public.check_submission_versions_insert_protected()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if nullif(current_setting('app.submission_workflow_rpc', true), '') = '1' then
    return new;
  end if;

  if new.finalized then
    raise exception 'Cannot insert a finalized version directly. Use RPC finalize_submission.';
  end if;

  return new;
end;
$$;

create trigger trg_submission_versions_insert_protected
  before insert on public.submission_versions
  for each row execute function public.check_submission_versions_insert_protected();

-- ============================================================
-- 3. 修复 RPC：create_submission_draft_version
--    全部对象使用 public. 前缀
-- ============================================================

create or replace function public.create_submission_draft_version(
  p_submission_id uuid
)
returns setof public.submission_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_existing public.submission_versions%rowtype;
  v_next_no int;
  v_new public.submission_versions%rowtype;
begin
  select * into v_submission
  from public.submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found.';
  end if;

  if v_submission.student_id <> auth.uid() then
    raise exception 'You do not own this submission.';
  end if;

  select * into v_existing
  from public.submission_versions
  where submission_id = p_submission_id
    and finalized = false
  order by version_no desc
  limit 1;

  if found then
    return next v_existing;
    return;
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next_no
  from public.submission_versions
  where submission_id = p_submission_id;

  perform set_config('app.submission_workflow_rpc', '1', true);
  insert into public.submission_versions (
    submission_id, version_no, text_answer, note,
    finalized, created_by
  ) values (
    p_submission_id, v_next_no, null, null,
    false, auth.uid()
  )
  returning * into v_new;
  perform set_config('app.submission_workflow_rpc', '', true);

  return next v_new;
  return;
end;
$$;

revoke all on function public.create_submission_draft_version(uuid) from public;
grant execute on function public.create_submission_draft_version(uuid) to authenticated;

-- ============================================================
-- 4. 修复 RPC：finalize_submission
--    全部对象使用 public. 前缀
-- ============================================================

create or replace function public.finalize_submission(
  p_submission_id uuid,
  p_version_id uuid,
  p_expected_version integer
)
returns table(
  submission_id uuid,
  status text,
  version integer,
  current_version_id uuid,
  version_id uuid,
  version_no int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_version public.submission_versions%rowtype;
  v_file_count int;
  v_next_status text;
begin
  select * into v_submission
  from public.submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found.';
  end if;

  if v_submission.student_id <> auth.uid() then
    raise exception 'You do not own this submission.';
  end if;

  select * into v_version
  from public.submission_versions
  where id = p_version_id
    and submission_id = p_submission_id;

  if not found then
    raise exception 'Version not found or does not belong to this submission.';
  end if;

  -- 幂等：已 finalize 的版本直接返回当前结果
  if v_version.finalized then
    submission_id := v_submission.id;
    status := v_submission.status::text;
    version := v_submission.version;
    current_version_id := v_submission.current_version_id;
    version_id := v_version.id;
    version_no := v_version.version_no;
    return next;
    return;
  end if;

  -- 乐观锁
  if v_submission.version <> p_expected_version then
    raise exception 'Concurrent modification detected. Expected version %, got %. Refresh and retry.',
      p_expected_version, v_submission.version;
  end if;

  -- 校验文本或文件至少一项非空
  if (v_version.text_answer is null or v_version.text_answer = '') then
    select count(*) into v_file_count
    from public.submission_files
    where version_id = p_version_id;

    if v_file_count = 0 then
      raise exception 'Cannot finalize: version has no text answer and no attached files.';
    end if;
  end if;

  -- finalized 原子操作
  perform set_config('app.submission_workflow_rpc', '1', true);
  update public.submission_versions
  set finalized = true,
      finalized_at = now()
  where id = p_version_id;
  perform set_config('app.submission_workflow_rpc', '', true);

  if v_submission.status = 'draft' then
    v_next_status := 'submitted';
  else
    v_next_status := 'resubmitted';
  end if;

  perform set_config('app.submission_workflow_rpc', '1', true);
  update public.submissions
  set status = v_next_status::public.submission_status,
      current_version_id = p_version_id,
      version = version + 1,
      updated_at = now()
  where id = p_submission_id;
  perform set_config('app.submission_workflow_rpc', '', true);

  return query
  select
    s.id,
    s.status::text,
    s.version,
    s.current_version_id,
    v.id,
    v.version_no
  from public.submissions s
  join public.submission_versions v on v.id = s.current_version_id
  where s.id = p_submission_id;
end;
$$;

revoke all on function public.finalize_submission(uuid, uuid, integer) from public;
grant execute on function public.finalize_submission(uuid, uuid, integer) to authenticated;

-- ============================================================
-- 5. 补充字段：organization_id / submission_id / bucket / created_by
--    （必须在 RLS 策略之前，策略引用这些列）
-- ============================================================

alter table public.submission_files
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists submission_id uuid references public.submissions(id) on delete cascade,
  add column if not exists bucket text not null default 'submissions',
  add column if not exists created_by uuid references public.profiles(id);

-- 回填 organization_id / submission_id（仅处理仍为 null 的行）
do $$
declare
  r record;
begin
  for r in
    select sf.id, sv.submission_id, s.organization_id
    from public.submission_files sf
    join public.submission_versions sv on sv.id = sf.version_id
    join public.submissions s on s.id = sv.submission_id
    where sf.organization_id is null or sf.submission_id is null
  loop
    update public.submission_files
    set organization_id = r.organization_id,
        submission_id = r.submission_id
    where id = r.id;
  end loop;
end;
$$;

-- 验证无 null 后设置 NOT NULL
do $$
declare
  null_count int;
begin
  select count(*) into null_count
  from public.submission_files
  where organization_id is null or submission_id is null;

  if null_count > 0 then
    raise exception 'Found % submission_files rows with null organization_id or submission_id after backfill.', null_count;
  end if;

  alter table public.submission_files
    alter column organization_id set not null,
    alter column submission_id set not null;
end;
$$;

-- ============================================================
-- 6. 修复 submission_files RLS 策略
-- ============================================================

drop policy if exists submission_files_select on public.submission_files;
create policy submission_files_select on public.submission_files for select to authenticated
  using (exists(
    select 1 from public.submissions s
    where s.id = submission_id
      and (s.student_id = auth.uid() or public.can_manage_task(s.task_id))
  ));

drop policy if exists submission_files_insert on public.submission_files;
create policy submission_files_insert on public.submission_files for insert to authenticated
  with check (
    created_by = auth.uid()
    and organization_id = public.auth_org_id()
    and exists(
      select 1 from public.submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

drop policy if exists submission_files_delete on public.submission_files;
create policy submission_files_delete on public.submission_files for delete to authenticated
  using (
    created_by = auth.uid()
    and exists(
      select 1 from public.submission_versions sv
      join public.submissions s on s.id = sv.submission_id
      where sv.id = public.submission_files.version_id
        and s.student_id = auth.uid()
        and sv.finalized = false
    )
  );

-- ============================================================
-- 7. 幂等补充 submission_files 约束
--    检查 pg_constraint 避免重复添加错误
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'submission_files_object_key_unique'
      and conrelid = 'public.submission_files'::regclass
  ) then
    alter table public.submission_files
      add constraint submission_files_object_key_unique unique (object_key);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'submission_files_file_size_nonneg'
      and conrelid = 'public.submission_files'::regclass
  ) then
    alter table public.submission_files
      add constraint submission_files_file_size_nonneg check (file_size >= 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'submission_files_sha256_format'
      and conrelid = 'public.submission_files'::regclass
  ) then
    alter table public.submission_files
      add constraint submission_files_sha256_format
        check (sha256 = '' or sha256 ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'submission_files_bucket_valid'
      and conrelid = 'public.submission_files'::regclass
  ) then
    alter table public.submission_files
      add constraint submission_files_bucket_valid
        check (bucket = 'submissions');
  end if;
end;
$$;

-- ============================================================
-- 8. 半迁移修复：补充索引
--    create index if not exists 本身幂等
-- ============================================================

create index if not exists idx_submission_files_submission
  on public.submission_files (submission_id);

create index if not exists idx_submission_files_org
  on public.submission_files (organization_id);

create index if not exists idx_submission_files_bucket_path
  on public.submission_files (bucket, object_key);

-- ============================================================
-- 9. 部分唯一索引：每个 submission 最多一个 draft
--    先检查有无重复，无重复才建立索引
-- ============================================================

do $$
declare
  dup_count int;
begin
  select count(*) into dup_count
  from (
    select submission_id
    from public.submission_versions
    where finalized = false
    group by submission_id
    having count(*) > 1
  ) dups;

  if dup_count > 0 then
    raise exception 'Found % submissions with multiple non-finalized drafts. '
      'Migration cannot proceed. Manual review required.', dup_count;
  end if;
end;
$$;

create unique index if not exists ux_submission_versions_one_draft
  on public.submission_versions (submission_id)
  where finalized = false;

-- ============================================================
-- 10. 修复 submission_versions RLS 策略
-- ============================================================

drop policy if exists submission_versions_update on public.submission_versions;
create policy submission_versions_update on public.submission_versions for update to authenticated
  using (
    created_by = auth.uid()
    and finalized = false
    and exists(select 1 from public.submissions s where s.id = submission_id and s.student_id = auth.uid())
  );

drop policy if exists submission_versions_insert on public.submission_versions;
create policy submission_versions_insert on public.submission_versions for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists(select 1 from public.submissions s where s.id = submission_id and s.student_id = auth.uid())
  );

-- ============================================================
-- 11. 完整重建 Storage RLS
--     删除所有旧策略，重建路径完整验证策略
-- ============================================================

-- 删除旧的宽泛策略（20260721000001 可能未成功删除）
drop policy if exists "submissions upload" on storage.objects;
drop policy if exists "submissions read" on storage.objects;
drop policy if exists "submissions update" on storage.objects;

-- 删除可能已部分创建的策略
drop policy if exists "submissions student upload" on storage.objects;
drop policy if exists "submissions student select" on storage.objects;
drop policy if exists "submissions teacher select" on storage.objects;
drop policy if exists "submissions student delete" on storage.objects;

-- 学生上传：校验完整8段路径 + DB关联
-- 路径：{orgId}/students/{stuId}/submissions/{subId}/versions/{verId}/{uuid-filename}
create policy "submissions student upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = public.auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = auth.uid()::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  and exists(
    select 1 from public.submissions s
    join public.submission_versions sv on sv.submission_id = s.id
    where s.id::text = (storage.foldername(name))[5]
      and sv.id::text = (storage.foldername(name))[7]
      and s.student_id = auth.uid()
      and not sv.finalized
      and sv.created_by = auth.uid()
  )
);

-- 学生读取：校验完整路径段 + DB关联
create policy "submissions student select" on storage.objects
for select to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = public.auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = auth.uid()::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  and exists(
    select 1 from public.submissions s
    where s.id::text = (storage.foldername(name))[5]
      and s.student_id = auth.uid()
  )
);

-- 教师读取：可读其可管理任务对应的学生文件
create policy "submissions teacher select" on storage.objects
for select to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = public.auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  and exists(
    select 1 from public.submissions s
    join public.tasks t on t.id = s.task_id
    where s.id::text = (storage.foldername(name))[5]
      and public.can_manage_task(t.id)
  )
);

-- 学生删除：只能删除自己未 finalize draft 的文件
create policy "submissions student delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = public.auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = auth.uid()::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  and exists(
    select 1 from public.submission_versions sv
    join public.submissions s on s.id = sv.submission_id
    where sv.id::text = (storage.foldername(name))[7]
      and s.id::text = (storage.foldername(name))[5]
      and s.student_id = auth.uid()
      and not sv.finalized
      and sv.created_by = auth.uid()
  )
);

-- ============================================================
-- 12. 验证半迁移状态
--     确认所有需要修复的对象均已存在
-- ============================================================

do $$
declare
  missing text[] := '{}';
begin
  -- 检查 RPC 函数
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_submission_draft_version') then
    missing := array_append(missing, 'RPC create_submission_draft_version');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'finalize_submission') then
    missing := array_append(missing, 'RPC finalize_submission');
  end if;

  -- 检查触发器
  if not exists (select 1 from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'submissions'
    and trigger_name = 'trg_submissions_update_protected') then
    missing := array_append(missing, 'trigger trg_submissions_update_protected');
  end if;
  if not exists (select 1 from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'submission_versions'
    and trigger_name = 'trg_submission_versions_update_protected') then
    missing := array_append(missing, 'trigger trg_submission_versions_update_protected');
  end if;
  if not exists (select 1 from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'submission_versions'
    and trigger_name = 'trg_submission_versions_insert_protected') then
    missing := array_append(missing, 'trigger trg_submission_versions_insert_protected');
  end if;

  -- 检查 storage 策略
  if not exists (select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'submissions student upload') then
    missing := array_append(missing, 'storage policy submissions student upload');
  end if;

  if cardinality(missing) > 0 then
    raise warning 'Migration state check: still missing objects: %', array_to_string(missing, ', ');
  end if;
end;
$$;
