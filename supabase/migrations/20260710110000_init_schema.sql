-- ============================================================
-- 20260710110000_init_schema.sql
-- 远程指导学习系统 — 初始数据库结构
-- 所有主键使用 UUID；时间统一 UTC (timestamptz)；含乐观锁 version 字段。
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 枚举类型 ----------
do $$ begin
  create type user_role as enum ('teacher', 'student', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('draft', 'published', 'closed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type submission_status as enum
    ('draft','uploading','submitted','ai_processing','grading','graded','returned','resubmitted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grading_status as enum ('draft','finalized','returned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_job_status as enum ('queued','running','succeeded','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_type as enum ('single','multiple','judge','blank','numeric','subjective');
exception when duplicate_object then null; end $$;

do $$ begin
  create type error_severity as enum ('minor','major','critical');
exception when duplicate_object then null; end $$;

-- ---------- 机构 / 用户 / 班级 ----------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- profiles.id 与 auth.users.id 一致（1:1）
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  role user_role not null default 'student',
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists class_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role_in_class text not null check (role_in_class in ('teacher','student')),
  created_at timestamptz not null default now(),
  unique (class_id, profile_id)
);

-- ---------- 任务 ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  description text not null default '',
  subject text not null default '',
  status task_status not null default 'draft',
  due_date timestamptz,
  full_score int not null default 100,
  allow_late boolean not null default false,
  allow_multiple boolean not null default true,
  creator_id uuid not null references profiles(id) on delete cascade,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  class_id uuid references classes(id) on delete cascade,
  student_id uuid references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (class_id is not null or student_id is not null)
);

create table if not exists task_resources (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  title text not null,
  url text not null,
  type text not null default 'link',
  created_at timestamptz not null default now()
);

create table if not exists task_questions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  order_no int not null default 0,
  type question_type not null,
  content text not null,
  answer_key text,           -- 敏感：客观题标准答案，仅服务端/教师可读（RLS 控制）
  score int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 作业与版本 ----------
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  status submission_status not null default 'draft',
  current_version_id uuid,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, student_id)
);

create table if not exists submission_versions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  version_no int not null,
  text_answer text,
  note text,
  finalized boolean not null default false,
  finalized_at timestamptz,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (submission_id, version_no)
);

create table if not exists submission_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references submission_versions(id) on delete cascade,
  file_name text not null,
  object_key text not null,
  file_size bigint not null default 0,
  mime_type text not null default '',
  sha256 text not null default '',
  scan_status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- ---------- 批改 ----------
create table if not exists grading_sessions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  score int,
  comment text,
  grader_id uuid not null references profiles(id) on delete cascade,
  ai_accepted boolean not null default false,
  status grading_status not null default 'draft',
  version int not null default 1,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id)
);

create table if not exists grading_items (
  id uuid primary key default gen_random_uuid(),
  grading_id uuid not null references grading_sessions(id) on delete cascade,
  question_id uuid not null references task_questions(id) on delete cascade,
  score int not null default 0,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists annotations (
  id uuid primary key default gen_random_uuid(),
  grading_id uuid not null references grading_sessions(id) on delete cascade,
  text text not null,
  severity error_severity not null default 'minor',
  error_category text,
  created_at timestamptz not null default now()
);

-- ---------- AI 任务 ----------
create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_version_id uuid not null references submission_versions(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  task_type text not null check (task_type in ('verification','grading')),
  status ai_job_status not null default 'queued',
  model_provider text,
  model_name text,
  model_version text,
  prompt_version text,
  skill_version text,
  input_hash text,
  idempotency_key text not null,
  retries int not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);

create table if not exists ai_model_runs (
  id uuid primary key default gen_random_uuid(),
  ai_job_id uuid not null references ai_jobs(id) on delete cascade,
  model_name text not null,
  prompt text,
  raw_output text,
  tokens_used int,
  confidence real,
  created_at timestamptz not null default now()
);

create table if not exists verification_results (
  id uuid primary key default gen_random_uuid(),
  ai_job_id uuid not null references ai_jobs(id) on delete cascade,
  question_id uuid references task_questions(id) on delete cascade,
  type text not null check (type in ('objective','subjective')),
  correct boolean,
  score int not null default 0,
  confidence real not null default 0,
  feedback text,
  created_at timestamptz not null default now()
);

-- ---------- 学习路径 ----------
create table if not exists learning_assessments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  progress_score int not null default 0,
  competency jsonb not null default '{}'::jsonb,
  weak_areas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  reason text not null default '',
  priority int not null default 0,
  skill_id uuid,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- 通知 ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null,
  title text not null,
  payload jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- 科目技能 ----------
create table if not exists subject_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  subject text not null,
  name text not null,
  version text not null default '1.0.0',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references subject_skills(id) on delete cascade,
  version text not null,
  changelog text,
  created_at timestamptz not null default now(),
  unique (skill_id, version)
);

create table if not exists task_skills (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  skill_id uuid not null references subject_skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, skill_id)
);

-- ---------- 审计日志 ----------
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  target text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- 外键补充：submissions.current_version_id
alter table submissions
  drop constraint if exists submissions_current_version_fk;
alter table submissions
  add constraint submissions_current_version_fk
  foreign key (current_version_id) references submission_versions(id) on delete set null;

-- ---------- 索引 ----------
create index if not exists idx_profiles_org on profiles(organization_id);
create index if not exists idx_classes_org on classes(organization_id);
create index if not exists idx_class_members_class on class_members(class_id);
create index if not exists idx_class_members_profile on class_members(profile_id);
create index if not exists idx_tasks_org on tasks(organization_id);
create index if not exists idx_tasks_creator on tasks(creator_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_task_assignees_task on task_assignees(task_id);
create index if not exists idx_task_assignees_class on task_assignees(class_id);
create index if not exists idx_task_assignees_student on task_assignees(student_id);
create index if not exists idx_task_questions_task on task_questions(task_id);
create index if not exists idx_task_resources_task on task_resources(task_id);
create index if not exists idx_submissions_task on submissions(task_id);
create index if not exists idx_submissions_student on submissions(student_id);
create index if not exists idx_submissions_org on submissions(organization_id);
create index if not exists idx_submission_versions_sub on submission_versions(submission_id);
create index if not exists idx_submission_files_version on submission_files(version_id);
create index if not exists idx_grading_sessions_sub on grading_sessions(submission_id);
create index if not exists idx_grading_items_grading on grading_items(grading_id);
create index if not exists idx_annotations_grading on annotations(grading_id);
create index if not exists idx_ai_jobs_status on ai_jobs(status);
create index if not exists idx_ai_jobs_version on ai_jobs(submission_version_id);
create index if not exists idx_verification_results_job on verification_results(ai_job_id);
create index if not exists idx_notifications_recipient on notifications(recipient_id);
create index if not exists idx_recommendations_student on recommendations(student_id);
create index if not exists idx_learning_assessments_student on learning_assessments(student_id);
create index if not exists idx_subject_skills_org on subject_skills(organization_id);
create index if not exists idx_task_skills_task on task_skills(task_id);
create index if not exists idx_audit_logs_org on audit_logs(organization_id);

-- ---------- updated_at 自动维护 ----------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tasks_updated on tasks;
create trigger trg_tasks_updated before update on tasks
  for each row execute function set_updated_at();

drop trigger if exists trg_submissions_updated on submissions;
create trigger trg_submissions_updated before update on submissions
  for each row execute function set_updated_at();

drop trigger if exists trg_grading_updated on grading_sessions;
create trigger trg_grading_updated before update on grading_sessions
  for each row execute function set_updated_at();

drop trigger if exists trg_ai_jobs_updated on ai_jobs;
create trigger trg_ai_jobs_updated before update on ai_jobs
  for each row execute function set_updated_at();
