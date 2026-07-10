-- ============================================================
-- 20260710110100_rls_policies.sql
-- 行级安全 (RLS) 策略。
-- 原则：
--   * 未登录用户不能读取任何业务数据。
--   * 学生只能访问本人数据。
--   * 教师只能访问其负责班级的数据。
--   * 管理员只能管理所属机构的数据。
--   * 前端传入的 role 永不作为权限依据，一切以数据库判断为准。
-- ============================================================

-- ---------- 辅助函数（SECURITY DEFINER，避免策略递归）----------
create or replace function auth_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid();
$$;

create or replace function auth_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

create or replace function is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('teacher','admin') from profiles where id = auth.uid()), false);
$$;

-- 判断当前教师是否负责某班级
create or replace function teaches_class(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from class_members cm
    where cm.class_id = cid and cm.profile_id = auth.uid() and cm.role_in_class = 'teacher'
  );
$$;

-- 判断学生是否在某班级
create or replace function in_class(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from class_members cm
    where cm.class_id = cid and cm.profile_id = auth.uid()
  );
$$;

-- 判断当前用户是否可见某任务（教师=创建者/授课班级；学生=被分配）
create or replace function can_view_task(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists(select 1 from tasks t where t.id = tid and t.creator_id = auth.uid())
    or exists(
      select 1 from task_assignees ta
      where ta.task_id = tid
        and (
          ta.student_id = auth.uid()
          or (ta.class_id is not null and in_class(ta.class_id))
        )
    )
    or exists(
      select 1 from tasks t
      where t.id = tid and is_admin() and t.organization_id = auth_org_id()
    );
$$;

-- 判断当前用户是否可管理某任务（创建者或本机构管理员）
create or replace function can_manage_task(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from tasks t
    where t.id = tid
      and (t.creator_id = auth.uid() or (is_admin() and t.organization_id = auth_org_id()))
  );
$$;

-- 判断当前教师是否可批改某作业（作业所属任务由其管理）
create or replace function can_grade_submission(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from submissions s
    where s.id = sid and can_manage_task(s.task_id)
  );
$$;

-- ---------- 启用 RLS ----------
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table classes enable row level security;
alter table class_members enable row level security;
alter table tasks enable row level security;
alter table task_assignees enable row level security;
alter table task_resources enable row level security;
alter table task_questions enable row level security;
alter table submissions enable row level security;
alter table submission_versions enable row level security;
alter table submission_files enable row level security;
alter table grading_sessions enable row level security;
alter table grading_items enable row level security;
alter table annotations enable row level security;
alter table ai_jobs enable row level security;
alter table ai_model_runs enable row level security;
alter table verification_results enable row level security;
alter table learning_assessments enable row level security;
alter table recommendations enable row level security;
alter table notifications enable row level security;
alter table subject_skills enable row level security;
alter table skill_versions enable row level security;
alter table task_skills enable row level security;
alter table audit_logs enable row level security;

-- ---------- organizations ----------
drop policy if exists org_select on organizations;
create policy org_select on organizations for select to authenticated
  using (id = auth_org_id());

-- ---------- profiles ----------
drop policy if exists profiles_self_insert on profiles;
create policy profiles_self_insert on profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or (organization_id = auth_org_id() and is_teacher())
  );

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- classes ----------
drop policy if exists classes_select on classes;
create policy classes_select on classes for select to authenticated
  using (
    organization_id = auth_org_id()
    and (is_admin() or teaches_class(id) or in_class(id))
  );

drop policy if exists classes_insert on classes;
create policy classes_insert on classes for insert to authenticated
  with check (organization_id = auth_org_id() and is_teacher() and created_by = auth.uid());

drop policy if exists classes_update on classes;
create policy classes_update on classes for update to authenticated
  using (organization_id = auth_org_id() and (is_admin() or created_by = auth.uid()));

-- ---------- class_members ----------
drop policy if exists class_members_select on class_members;
create policy class_members_select on class_members for select to authenticated
  using (profile_id = auth.uid() or teaches_class(class_id) or is_admin());

drop policy if exists class_members_insert on class_members;
create policy class_members_insert on class_members for insert to authenticated
  with check (is_teacher() and exists(
    select 1 from classes c where c.id = class_id and c.organization_id = auth_org_id()
  ));

drop policy if exists class_members_delete on class_members;
create policy class_members_delete on class_members for delete to authenticated
  using (teaches_class(class_id) or is_admin());

-- ---------- tasks ----------
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using (can_view_task(id));

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated
  with check (is_teacher() and organization_id = auth_org_id() and creator_id = auth.uid());

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using (can_manage_task(id)) with check (organization_id = auth_org_id());

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete to authenticated
  using (can_manage_task(id) and status = 'draft');

-- ---------- task_assignees ----------
drop policy if exists task_assignees_select on task_assignees;
create policy task_assignees_select on task_assignees for select to authenticated
  using (can_view_task(task_id));

drop policy if exists task_assignees_write on task_assignees;
create policy task_assignees_write on task_assignees for all to authenticated
  using (can_manage_task(task_id)) with check (can_manage_task(task_id));

-- ---------- task_resources ----------
drop policy if exists task_resources_select on task_resources;
create policy task_resources_select on task_resources for select to authenticated
  using (can_view_task(task_id));

drop policy if exists task_resources_write on task_resources;
create policy task_resources_write on task_resources for all to authenticated
  using (can_manage_task(task_id)) with check (can_manage_task(task_id));

-- ---------- task_questions ----------
-- 学生可见题干；answer_key 的保护在应用层按角色投影（教师读全字段，学生视图不取 answer_key）。
drop policy if exists task_questions_select on task_questions;
create policy task_questions_select on task_questions for select to authenticated
  using (can_view_task(task_id));

drop policy if exists task_questions_write on task_questions;
create policy task_questions_write on task_questions for all to authenticated
  using (can_manage_task(task_id)) with check (can_manage_task(task_id));

-- ---------- submissions ----------
drop policy if exists submissions_select on submissions;
create policy submissions_select on submissions for select to authenticated
  using (student_id = auth.uid() or can_manage_task(task_id));

drop policy if exists submissions_insert on submissions;
create policy submissions_insert on submissions for insert to authenticated
  with check (
    student_id = auth.uid()
    and organization_id = auth_org_id()
    and can_view_task(task_id)
  );

drop policy if exists submissions_update on submissions;
create policy submissions_update on submissions for update to authenticated
  using (student_id = auth.uid() or can_grade_submission(id))
  with check (student_id = auth.uid() or can_grade_submission(id));

-- ---------- submission_versions ----------
drop policy if exists submission_versions_select on submission_versions;
create policy submission_versions_select on submission_versions for select to authenticated
  using (exists(
    select 1 from submissions s where s.id = submission_id
      and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists submission_versions_insert on submission_versions;
create policy submission_versions_insert on submission_versions for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists(select 1 from submissions s where s.id = submission_id and s.student_id = auth.uid())
  );

-- 仅允许更新未 finalize 的版本；finalize 后不可改。
drop policy if exists submission_versions_update on submission_versions;
create policy submission_versions_update on submission_versions for update to authenticated
  using (
    created_by = auth.uid() and finalized = false
    and exists(select 1 from submissions s where s.id = submission_id and s.student_id = auth.uid())
  );

-- ---------- submission_files ----------
drop policy if exists submission_files_select on submission_files;
create policy submission_files_select on submission_files for select to authenticated
  using (exists(
    select 1 from submission_versions sv
    join submissions s on s.id = sv.submission_id
    where sv.id = version_id and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists submission_files_insert on submission_files;
create policy submission_files_insert on submission_files for insert to authenticated
  with check (exists(
    select 1 from submission_versions sv
    join submissions s on s.id = sv.submission_id
    where sv.id = version_id and s.student_id = auth.uid()
  ));

-- ---------- grading_sessions ----------
drop policy if exists grading_sessions_select on grading_sessions;
create policy grading_sessions_select on grading_sessions for select to authenticated
  using (exists(
    select 1 from submissions s where s.id = submission_id
      and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists grading_sessions_write on grading_sessions;
create policy grading_sessions_write on grading_sessions for all to authenticated
  using (can_grade_submission(submission_id))
  with check (can_grade_submission(submission_id) and grader_id = auth.uid());

-- ---------- grading_items ----------
drop policy if exists grading_items_select on grading_items;
create policy grading_items_select on grading_items for select to authenticated
  using (exists(
    select 1 from grading_sessions g
    join submissions s on s.id = g.submission_id
    where g.id = grading_id and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists grading_items_write on grading_items;
create policy grading_items_write on grading_items for all to authenticated
  using (exists(select 1 from grading_sessions g where g.id = grading_id and can_grade_submission(g.submission_id)))
  with check (exists(select 1 from grading_sessions g where g.id = grading_id and can_grade_submission(g.submission_id)));

-- ---------- annotations ----------
drop policy if exists annotations_select on annotations;
create policy annotations_select on annotations for select to authenticated
  using (exists(
    select 1 from grading_sessions g
    join submissions s on s.id = g.submission_id
    where g.id = grading_id and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists annotations_write on annotations;
create policy annotations_write on annotations for all to authenticated
  using (exists(select 1 from grading_sessions g where g.id = grading_id and can_grade_submission(g.submission_id)))
  with check (exists(select 1 from grading_sessions g where g.id = grading_id and can_grade_submission(g.submission_id)));

-- ---------- ai_jobs / ai_model_runs / verification_results ----------
drop policy if exists ai_jobs_select on ai_jobs;
create policy ai_jobs_select on ai_jobs for select to authenticated
  using (exists(
    select 1 from submission_versions sv
    join submissions s on s.id = sv.submission_id
    where sv.id = submission_version_id and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists ai_jobs_insert on ai_jobs;
create policy ai_jobs_insert on ai_jobs for insert to authenticated
  with check (exists(
    select 1 from submission_versions sv
    join submissions s on s.id = sv.submission_id
    where sv.id = submission_version_id
      and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists verification_results_select on verification_results;
create policy verification_results_select on verification_results for select to authenticated
  using (exists(
    select 1 from ai_jobs j
    join submission_versions sv on sv.id = j.submission_version_id
    join submissions s on s.id = sv.submission_id
    where j.id = ai_job_id and (s.student_id = auth.uid() or can_manage_task(s.task_id))
  ));

drop policy if exists ai_model_runs_select on ai_model_runs;
create policy ai_model_runs_select on ai_model_runs for select to authenticated
  using (exists(
    select 1 from ai_jobs j
    join submission_versions sv on sv.id = j.submission_version_id
    join submissions s on s.id = sv.submission_id
    where j.id = ai_job_id and can_manage_task(s.task_id)
  ));

-- ---------- learning_assessments / recommendations ----------
drop policy if exists learning_assessments_select on learning_assessments;
create policy learning_assessments_select on learning_assessments for select to authenticated
  using (student_id = auth.uid() or (is_teacher() and organization_id = auth_org_id()));

drop policy if exists recommendations_select on recommendations;
create policy recommendations_select on recommendations for select to authenticated
  using (student_id = auth.uid() or (is_teacher() and organization_id = auth_org_id()));

drop policy if exists recommendations_write on recommendations;
create policy recommendations_write on recommendations for all to authenticated
  using (is_teacher() and organization_id = auth_org_id())
  with check (is_teacher() and organization_id = auth_org_id());

-- ---------- notifications ----------
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

drop policy if exists notifications_insert on notifications;
create policy notifications_insert on notifications for insert to authenticated
  with check (organization_id = auth_org_id());

-- ---------- subject_skills / skill_versions / task_skills ----------
drop policy if exists subject_skills_select on subject_skills;
create policy subject_skills_select on subject_skills for select to authenticated
  using (organization_id = auth_org_id());

drop policy if exists subject_skills_write on subject_skills;
create policy subject_skills_write on subject_skills for all to authenticated
  using (is_teacher() and organization_id = auth_org_id())
  with check (is_teacher() and organization_id = auth_org_id());

drop policy if exists skill_versions_select on skill_versions;
create policy skill_versions_select on skill_versions for select to authenticated
  using (exists(select 1 from subject_skills sk where sk.id = skill_id and sk.organization_id = auth_org_id()));

drop policy if exists task_skills_select on task_skills;
create policy task_skills_select on task_skills for select to authenticated
  using (can_view_task(task_id));

drop policy if exists task_skills_write on task_skills;
create policy task_skills_write on task_skills for all to authenticated
  using (can_manage_task(task_id)) with check (can_manage_task(task_id));

-- ---------- audit_logs ----------
drop policy if exists audit_logs_select on audit_logs;
create policy audit_logs_select on audit_logs for select to authenticated
  using (is_admin() and organization_id = auth_org_id());

drop policy if exists audit_logs_insert on audit_logs;
create policy audit_logs_insert on audit_logs for insert to authenticated
  with check (organization_id = auth_org_id());
