-- ============================================================
-- 20260710110300_realtime.sql
-- 将业务表加入 supabase_realtime publication，
-- 使前端可订阅 submissions / grading_sessions / notifications 的变化。
-- 通过 GitHub 部署自动应用，无需手动在 Dashboard 勾选。
-- ============================================================

do $$
begin
  -- publication 在 Supabase 项目中默认已存在；若无则创建。
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- 逐表加入（若已在 publication 中则忽略错误）
do $$
begin
  alter publication supabase_realtime add table public.submissions;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.grading_sessions;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- 确保变更行携带完整数据，便于前端识别（可选，UPDATE 时携带旧值）
alter table public.submissions replica identity full;
alter table public.grading_sessions replica identity full;
alter table public.notifications replica identity full;
