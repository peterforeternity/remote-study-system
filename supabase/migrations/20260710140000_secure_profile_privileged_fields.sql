-- ============================================================
-- 20260710140000_secure_profile_privileged_fields.sql
-- 修复提权漏洞：此前 authenticated 拥有 profiles 表级 UPDATE，
-- 学生可自行将 profiles.role 改为 admin，从而使 is_admin() 返回 true。
--
-- profiles 实际字段：id, organization_id, name, role, email, created_at
--   * 普通用户可编辑：name
--   * 受保护（禁止普通用户修改）：id, role, organization_id, email, created_at
--
-- 防御分两层：
--   1) 列级权限：撤销表级 UPDATE，仅授予 name 列的 UPDATE。
--   2) BEFORE UPDATE 触发器：纵深防御，敏感字段变化时拒绝
--      （service_role / 受信服务端流程放行）。
--
-- 原则：不关闭 RLS；不使用 with check (true)；权限由数据库判断；幂等。
-- 保留既有 profiles_self_update RLS（普通用户仍只能更新自己的行）。
-- ============================================================

-- ---------- 1. 列级权限 ----------
-- 撤销 authenticated 的整表 UPDATE，改为仅允许安全字段。
revoke update on table public.profiles from authenticated;
grant update (name) on table public.profiles to authenticated;

-- ---------- 2. 敏感字段保护触发器（纵深防御）----------
-- 判断当前请求是否来自 service_role（兼容两种 JWT claim GUC 形式）。
create or replace function public.is_service_role_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role')
  ) = 'service_role';
$$;

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from new.role
     or old.organization_id is distinct from new.organization_id
     or old.id is distinct from new.id
     or old.email is distinct from new.email
     or old.created_at is distinct from new.created_at then

    -- 仅 service_role（受信服务端/管理脚本）可修改敏感字段。
    if not public.is_service_role_request() then
      raise exception 'privileged profile fields (id/role/organization_id/email/created_at) cannot be changed'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
  before update on public.profiles
  for each row
  execute function public.protect_profile_privileged_fields();

-- ---------- 3. 角色变更仅走服务端 ----------
-- 当前阶段无管理员角色管理 UI，角色修改仅允许通过 service_role 管理脚本执行
-- （见 scripts/create-test-users.mjs）。前端不得直接 update({ role })：
--   * 列级权限已阻止（未授予 role 列 UPDATE）。
--   * 触发器再次兜底拒绝。
-- 不在本阶段创建角色管理 RPC，避免引入未使用的提权入口。
