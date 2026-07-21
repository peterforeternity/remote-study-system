-- ============================================================
-- 20260721XXXXXX_secure_submission_workflow.sql
-- 修复 submission 状态与版本字段的直接修改漏洞。
--
-- 变更：
--  1. submissions: 撤销 authenticated 直接 UPDATE → 仅 RPC 可改
--  2. submission_versions: 列级保护触发器
--  3. submission_files: 补充 organization_id/submission_id/bucket/created_by
--  4. 新增约束与索引
-- ============================================================

-- ---------- 1. submissions：撤销直接 UPDATE，全部改为 RPC ----------
-- 删除宽松的 submissions_update RLS 策略，替换为保护触发器。
-- RPC 通过 set_config('app.submission_workflow_rpc', '1', true) 获取豁免。

drop policy if exists submissions_update on submissions;

create or replace function check_submissions_update_protected()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- RPC 调用时设置了 bypass 标记，跳过保护
  if nullif(current_setting('app.submission_workflow_rpc', true), '') = '1' then
    return new;
  end if;

  -- 教师通过 grading RLS 函数仍可更新（批改流程暂未全部迁移至 RPC）
  if can_grade_submission(old.id) then
    return new;
  end if;

  -- 禁止学生/普通用户直接 UPDATE submissions
  raise exception 'Direct UPDATE on submissions is forbidden. Use the RPC API (finalize_submission etc.).';
end;
$$;

drop trigger if exists trg_submissions_update_protected on submissions;
create trigger trg_submissions_update_protected
  before update on submissions
  for each row execute function check_submissions_update_protected();

-- ---------- 2. submission_versions：列级保护 ----------

create or replace function check_submission_versions_update_protected()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- RPC 豁免
  if nullif(current_setting('app.submission_workflow_rpc', true), '') = '1' then
    return new;
  end if;

  -- finalized 版本不可修改任何字段
  if old.finalized then
    raise exception 'Finalized versions are immutable.';
  end if;

  -- 禁止将 finalized 设为 true（必须通过 RPC）
  if new.finalized and not old.finalized then
    raise exception 'Cannot set finalized=true directly. Use RPC finalize_submission.';
  end if;

  -- 禁止修改不可变字段：submission_id, version_no, finalized_at, created_by, created_at
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

  -- 仅允许修改 text_answer 和 note
  return new;
end;
$$;

drop trigger if exists trg_submission_versions_update_protected on submission_versions;
create trigger trg_submission_versions_update_protected
  before update on submission_versions
  for each row execute function check_submission_versions_update_protected();

-- BEFORE INSERT 保护：禁止学生直接插入 finalized=true 的版本
create or replace function check_submission_versions_insert_protected()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- RPC 豁免
  if nullif(current_setting('app.submission_workflow_rpc', true), '') = '1' then
    return new;
  end if;

  -- 禁止直接插入已 finalize 的版本
  if new.finalized then
    raise exception 'Cannot insert a finalized version directly. Use RPC finalize_submission.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_submission_versions_insert_protected on submission_versions;
create trigger trg_submission_versions_insert_protected
  before insert on submission_versions
  for each row execute function check_submission_versions_insert_protected();

-- 部分唯一索引：每个 submission 最多一个未 finalize 的 draft
-- 执行前清理可能存在的多个 draft（保留最新的，删除更早的）
do $$
declare
  dup record;
begin
  for dup in
    select submission_id, array_agg(id order by created_at desc) as ids
    from submission_versions
    where finalized = false
    group by submission_id
    having count(*) > 1
  loop
    -- 保留最新的 draft（ids[1]），删除其余
    delete from submission_versions
    where id = any(dup.ids[2:array_length(dup.ids, 1)]);
    raise notice 'Cleaned % duplicate drafts for submission %', array_length(dup.ids, 1) - 1, dup.submission_id;
  end loop;
end;
$$;

create unique index if not exists ux_submission_versions_one_draft
  on submission_versions (submission_id)
  where finalized = false;

-- 撤销原有宽松的 submission_versions UPDATE RLS，替换为仅允许 draft 修改 text_answer/note
-- 列级保护由 trigger 强制执行
drop policy if exists submission_versions_update on submission_versions;
create policy submission_versions_update on submission_versions for update to authenticated
  using (
    created_by = auth.uid()
    and finalized = false
    and exists(select 1 from submissions s where s.id = submission_id and s.student_id = auth.uid())
  );

-- 撤销原有 INSERT RLS（允许插入任意字段），替换为仅允许插入 draft（finalized=false）
-- 列级保护由 insert trigger 强制执行
drop policy if exists submission_versions_insert on submission_versions;
create policy submission_versions_insert on submission_versions for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists(select 1 from submissions s where s.id = submission_id and s.student_id = auth.uid())
  );

-- ---------- 3. submission_files：补充必要字段 ----------

-- 新增可为 null 的列
alter table submission_files
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists submission_id uuid references submissions(id) on delete cascade,
  add column if not exists bucket text not null default 'submissions',
  add column if not exists created_by uuid references profiles(id);

-- 回填 organization_id / submission_id
do $$
declare
  r record;
begin
  for r in
    select sf.id, sv.submission_id, s.organization_id
    from submission_files sf
    join submission_versions sv on sv.id = sf.version_id
    join submissions s on s.id = sv.submission_id
    where sf.organization_id is null or sf.submission_id is null
  loop
    update submission_files
    set organization_id = r.organization_id,
        submission_id = r.submission_id
    where id = r.id;
  end loop;
end;
$$;

-- 添加 NOT NULL 约束（回填完成后）
alter table submission_files
  alter column organization_id set not null,
  alter column submission_id set not null;

-- ---------- 4. 新增约束 ----------

-- object_key 唯一
alter table submission_files
  add constraint submission_files_object_key_unique unique (object_key);

-- file_size >= 0
alter table submission_files
  add constraint submission_files_file_size_nonneg check (file_size >= 0);

-- sha256 为空或 64 位 hex
alter table submission_files
  add constraint submission_files_sha256_format
    check (sha256 = '' or sha256 ~ '^[0-9a-f]{64}$');

-- bucket 只能是 'submissions'
alter table submission_files
  add constraint submission_files_bucket_valid
    check (bucket = 'submissions');

-- ---------- 5. 新增索引 ----------

create index if not exists idx_submission_files_submission
  on submission_files (submission_id);

create index if not exists idx_submission_files_org
  on submission_files (organization_id);

create index if not exists idx_submission_files_bucket_path
  on submission_files (bucket, object_key);

-- ---------- 6. 更新 submission_files SELECT RLS（通过 submission_id 关联） ----------
drop policy if exists submission_files_select on submission_files;
create policy submission_files_select on submission_files for select to authenticated
  using (exists(
    select 1 from submissions s
    where s.id = submission_id
      and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

-- INSERT：学生只能为自己的 submission 插入文件
drop policy if exists submission_files_insert on submission_files;
create policy submission_files_insert on submission_files for insert to authenticated
  with check (
    created_by = auth.uid()
    and organization_id = auth_org_id()
    and exists(
      select 1 from submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

-- DELETE：学生可删除自己未 finalized version 的文件；教师不可删除
drop policy if exists submission_files_delete on submission_files;
create policy submission_files_delete on submission_files for delete to authenticated
  using (
    created_by = auth.uid()
    and exists(
      select 1 from submission_versions sv
      join submissions s on s.id = sv.submission_id
      where sv.id = submission_files.version_id
        and s.student_id = auth.uid()
        and sv.finalized = false
    )
  );

-- ============================================================
-- 阶段 C：受控 RPC 函数
-- ============================================================

-- ---------- create_submission_draft_version ----------
-- 为学生创建或返回当前未 finalize 的草稿版本。
-- 并发安全：两次并发调用只产生一个 draft。

create or replace function create_submission_draft_version(
  p_submission_id uuid
)
returns setof submission_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission submissions;
  v_existing submission_versions;
  v_next_no int;
  v_new submission_versions;
begin
  -- 锁定 submission
  select * into v_submission
  from submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found.';
  end if;

  -- 校验属于当前学生
  if v_submission.student_id <> auth.uid() then
    raise exception 'You do not own this submission.';
  end if;

  -- 检查是否已有未 finalize 的 draft
  select * into v_existing
  from submission_versions
  where submission_id = p_submission_id
    and finalized = false
  order by version_no desc
  limit 1;

  if found then
    -- 直接返回已有 draft
    return next v_existing;
    return;
  end if;

  -- 计算下一版本号
  select coalesce(max(version_no), 0) + 1 into v_next_no
  from submission_versions
  where submission_id = p_submission_id;

  -- 插入新 draft（设置 bypass 标记以绕过 insert 触发器）
  perform set_config('app.submission_workflow_rpc', '1', true);
  insert into submission_versions (
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

revoke all on function create_submission_draft_version(uuid) from public;
grant execute on function create_submission_draft_version(uuid) to authenticated;

-- ---------- finalize_submission ----------
-- 正式提交一个 draft 版本。原子操作：锁定→校验→finalize→更新状态。
-- 乐观锁：p_expected_version 防止并发覆盖。
-- 幂等：重复调用同一已 finalize 版本直接返回当前结果。

create or replace function finalize_submission(
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
  v_submission submissions;
  v_version submission_versions;
  v_file_count int;
  v_next_status text;
begin
  -- 1. 锁定 submission
  select * into v_submission
  from submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found.';
  end if;

  -- 2. 校验 student_id
  if v_submission.student_id <> auth.uid() then
    raise exception 'You do not own this submission.';
  end if;

  -- 4. 校验 version 存在且属于该 submission
  select * into v_version
  from submission_versions
  where id = p_version_id
    and submission_id = p_submission_id;

  if not found then
    raise exception 'Version not found or does not belong to this submission.';
  end if;

  -- 11. 幂等：如果已经是 finalized，直接返回当前结果
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

  -- 5. 乐观锁：校验 expected_version
  if v_submission.version <> p_expected_version then
    raise exception 'Concurrent modification detected. Expected version %, got %. Refresh and retry.',
      p_expected_version, v_submission.version;
  end if;

  -- 5. 校验至少存在非空 text_answer 或一个 submission_files
  if (v_version.text_answer is null or v_version.text_answer = '') then
    select count(*) into v_file_count
    from submission_files
    where version_id = p_version_id;

    if v_file_count = 0 then
      raise exception 'Cannot finalize: version has no text answer and no attached files.';
    end if;
  end if;

  -- 7. 设置 version finalized
  perform set_config('app.submission_workflow_rpc', '1', true);
  update submission_versions
  set finalized = true,
      finalized_at = now()
  where id = p_version_id;
  perform set_config('app.submission_workflow_rpc', '', true);

  -- 9. 确定新状态
  if v_submission.status = 'draft' then
    v_next_status := 'submitted';
  else
    v_next_status := 'resubmitted';
  end if;

  -- 8. 更新 submissions：current_version_id, status, version++
  perform set_config('app.submission_workflow_rpc', '1', true);
  update submissions
  set status = v_next_status::submission_status,
      current_version_id = p_version_id,
      version = version + 1,
      updated_at = now()
  where id = p_submission_id;
  perform set_config('app.submission_workflow_rpc', '', true);

  -- 返回结果
  return query
  select
    s.id as submission_id,
    s.status::text as status,
    s.version,
    s.current_version_id,
    v.id as version_id,
    v.version_no
  from submissions s
  join submission_versions v on v.id = s.current_version_id
  where s.id = p_submission_id;
end;
$$;

revoke all on function finalize_submission(uuid, uuid, integer) from public;
grant execute on function finalize_submission(uuid, uuid, integer) to authenticated;

-- ============================================================
-- 阶段 D：重写 Storage RLS
-- ============================================================
-- 对象路径统一格式（复用 submissions 桶）：
--   {organizationId}/students/{studentId}/submissions/{submissionId}/versions/{versionId}/{uuid}-{safeFileName}
--
-- 策略：不提供 UPDATE。INSERT/SELECT/DELETE 每条策略校验全部路径段。

-- 删除旧的宽泛策略
drop policy if exists "submissions upload" on storage.objects;
drop policy if exists "submissions read" on storage.objects;
drop policy if exists "submissions update" on storage.objects;

-- 学生上传：校验全部8段路径，DB关联校验submission归属和version未finalize
drop policy if exists "submissions student upload" on storage.objects;
create policy "submissions student upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = auth.uid()::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  -- 校验 submission 属于当前学生且 version 存在、未 finalize
  and exists(
    select 1 from submissions s
    join submission_versions sv on sv.submission_id = s.id
    where s.id::text = (storage.foldername(name))[5]
      and sv.id::text = (storage.foldername(name))[7]
      and s.student_id = auth.uid()
      and not sv.finalized
      and sv.created_by = auth.uid()
  )
);

-- 学生读取：只能读自己的文件，校验完整路径段
drop policy if exists "submissions student select" on storage.objects;
create policy "submissions student select" on storage.objects
for select to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = auth.uid()::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  and exists(
    select 1 from submissions s
    where s.id::text = (storage.foldername(name))[5]
      and s.student_id = auth.uid()
  )
);

-- 教师读取：可读其可管理任务对应的学生文件
drop policy if exists "submissions teacher select" on storage.objects;
create policy "submissions teacher select" on storage.objects
for select to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  and exists(
    select 1 from submissions s
    join tasks t on t.id = s.task_id
    where s.id::text = (storage.foldername(name))[5]
      and can_manage_task(t.id)
  )
);

-- 学生删除：只能删除自己未 finalize draft 的文件
drop policy if exists "submissions student delete" on storage.objects;
create policy "submissions student delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth_org_id()::text
  and (storage.foldername(name))[2] = 'students'
  and (storage.foldername(name))[3] = auth.uid()::text
  and (storage.foldername(name))[4] = 'submissions'
  and (storage.foldername(name))[6] = 'versions'
  and array_length(storage.foldername(name), 1) = 8
  and exists(
    select 1 from submission_versions sv
    join submissions s on s.id = sv.submission_id
    where sv.id::text = (storage.foldername(name))[7]
      and s.id::text = (storage.foldername(name))[5]
      and s.student_id = auth.uid()
      and not sv.finalized
      and sv.created_by = auth.uid()
  )
);
