-- ============================================================
-- 修复 finalize_submission RPC：乐观锁检查应在幂等返回之前
-- 保证客户端传入过期 expected_version 时始终报错
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
  perform set_config('app.submission_workflow_rpc', '1', true);

  select * into v_submission
  from public.submissions
  where id = p_submission_id
  for update;

  if not found then
    perform set_config('app.submission_workflow_rpc', '', true);
    raise exception 'Submission not found.';
  end if;

  if v_submission.student_id <> auth.uid() then
    perform set_config('app.submission_workflow_rpc', '', true);
    raise exception 'You do not own this submission.';
  end if;

  select * into v_version
  from public.submission_versions
  where id = p_version_id
    and public.submission_versions.submission_id = p_submission_id;

  if not found then
    perform set_config('app.submission_workflow_rpc', '', true);
    raise exception 'Version not found or does not belong to this submission.';
  end if;

  -- 乐观锁：先检查（对已 finalize 的版本也检查，提示客户端数据过期）
  if v_submission.version <> p_expected_version then
    perform set_config('app.submission_workflow_rpc', '', true);
    raise exception 'Concurrent modification detected. Expected version %, got %. Refresh and retry.',
      p_expected_version, v_submission.version;
  end if;

  -- 幂等：版本号匹配时，对已 finalize 的版本直接返回
  if v_version.finalized then
    submission_id := v_submission.id;
    status := v_submission.status::text;
    version := v_submission.version;
    current_version_id := v_submission.current_version_id;
    version_id := v_version.id;
    version_no := v_version.version_no;
    perform set_config('app.submission_workflow_rpc', '', true);
    return next;
    return;
  end if;

  -- 校验文本或文件至少一项非空
  if (v_version.text_answer is null or v_version.text_answer = '') then
    select count(*) into v_file_count
    from public.submission_files
    where version_id = p_version_id;

    if v_file_count = 0 then
      perform set_config('app.submission_workflow_rpc', '', true);
      raise exception 'Cannot finalize: version has no text answer and no attached files.';
    end if;
  end if;

  -- 标记 version 为 finalized
  update public.submission_versions
  set finalized = true,
      finalized_at = now()
  where id = p_version_id;

  if v_submission.status = 'draft' then
    v_next_status := 'submitted';
  else
    v_next_status := 'resubmitted';
  end if;

  -- 更新 submission
  update public.submissions
  set status = v_next_status::public.submission_status,
      current_version_id = p_version_id,
      version = public.submissions.version + 1,
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
