-- ============================================================
-- 20260710160000_signup_invite_codes.sql
-- 用户自助注册机制（邀请码加入机构，仅限学生角色）。
--
-- 安全设计：
--  1. 新增 invite_codes 表，由教师/管理员为本机构生成邀请码。
--  2. auth.users 上的 SECURITY DEFINER 触发器 handle_new_user()
--     在注册时读取 raw_user_meta_data.invite_code，校验后自动创建 profile，
--     角色强制为 'student'，机构取自邀请码 —— 前端无法自定义角色，杜绝提权。
--  3. 移除旧的 profiles_self_insert 策略（此前允许前端自插任意 role，存在提权风险）。
--     profile 统一由触发器（definer 权限，绕过 RLS）或 service_role 脚本创建。
-- 幂等：可重复部署。
-- ============================================================

-- ---------- 1. 邀请码表 ----------
create table if not exists invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid not null references profiles(id) on delete cascade,
  max_uses integer,                 -- null 表示不限次数
  used_count integer not null default 0,
  expires_at timestamptz,           -- null 表示永不过期
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_invite_codes_code on invite_codes (code);
create index if not exists idx_invite_codes_org on invite_codes (organization_id);

alter table invite_codes enable row level security;

-- 教师/管理员可查看本机构邀请码
drop policy if exists invite_codes_select on invite_codes;
create policy invite_codes_select on invite_codes for select to authenticated
  using (is_teacher() and organization_id = auth_org_id());

-- 教师/管理员可为本机构创建邀请码
drop policy if exists invite_codes_insert on invite_codes;
create policy invite_codes_insert on invite_codes for insert to authenticated
  with check (
    is_teacher()
    and organization_id = auth_org_id()
    and created_by = auth.uid()
  );

-- 教师/管理员可停用/更新本机构邀请码
drop policy if exists invite_codes_update on invite_codes;
create policy invite_codes_update on invite_codes for update to authenticated
  using (is_teacher() and organization_id = auth_org_id())
  with check (is_teacher() and organization_id = auth_org_id());

-- ---------- 2. 注册触发器 ----------
-- 读取注册元数据中的 invite_code，校验后创建学生 profile 并累加使用次数。
-- 无 invite_code 时（如 service_role 脚本创建的用户）直接跳过，由调用方自行建 profile。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''),
                          split_part(new.email, '@', 1));
  v_invite public.invite_codes%rowtype;
begin
  if v_code is null then
    return new;
  end if;

  select * into v_invite
  from public.invite_codes
  where code = v_code
    and active = true
    and (expires_at is null or expires_at > now())
    and (max_uses is null or used_count < max_uses)
  for update;

  if not found then
    raise exception '邀请码无效或已过期' using errcode = '22023';
  end if;

  insert into public.profiles (id, organization_id, name, role, email)
  values (new.id, v_invite.organization_id, v_name, 'student', new.email);

  update public.invite_codes
  set used_count = used_count + 1
  where id = v_invite.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. 移除不安全的前端自插策略 ----------
drop policy if exists profiles_self_insert on profiles;
