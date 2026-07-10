-- ============================================================
-- seed.sql — 种子数据（仅包含不依赖真实 auth 用户的数据）
--
-- 重要说明：
--   Supabase 的可登录测试账号必须通过 Admin API 创建，
--   直接向 auth.users INSERT 无法可靠生成可登录用户。
--   因此测试用户、班级、依赖用户的示例任务，请运行：
--       node scripts/create-test-users.mjs
--   本文件只灌入机构与科目技能等与 auth 无关的基础数据。
--
-- 执行时机：
--   * supabase db reset 会在 migrations 之后自动执行本文件；
--   * 之后再运行 create-test-users.mjs 创建账号与班级。
-- ============================================================

-- 机构（与 Admin API 脚本使用同一固定 ID）
insert into organizations (id, name)
values ('00000000-0000-0000-0000-0000000000aa', '示范中学')
on conflict (id) do nothing;

-- 科目技能（不依赖用户）
insert into subject_skills (organization_id, subject, name, version, enabled)
values
  ('00000000-0000-0000-0000-0000000000aa', '数学', '数学客观题评分', '1.0.0', true),
  ('00000000-0000-0000-0000-0000000000aa', '英语', '英语作答评估', '1.0.0', true),
  ('00000000-0000-0000-0000-0000000000aa', '编程', '代码作业评估', '1.0.0', true),
  ('00000000-0000-0000-0000-0000000000aa', '语文', '语文主观题反馈', '1.0.0', true)
on conflict do nothing;
