# 远程指导学习系统 (Remote Study System)

教师与学生实时协作的远程指导学习平台。前端 React + TypeScript + Vite，云端 Supabase（PostgreSQL / Auth / Storage / Realtime），AI Worker 为 Node.js + TypeScript。

> 完整设计见 `../.trae/documents/` 下的 PRD 与技术架构文档。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite |
| UI | Tailwind CSS + Lucide React |
| 路由 | React Router |
| 服务端状态 | TanStack Query |
| 本地 UI 状态 | Zustand |
| 表单 | React Hook Form + Zod |
| 云端 | Supabase（PostgreSQL / Auth / Storage / Realtime / Edge Functions） |
| AI Worker | Node.js + TypeScript（轮询 `ai_jobs`） |
| PWA | vite-plugin-pwa + IndexedDB |
| 测试 | Vitest + React Testing Library + Playwright |

## 目录结构

```
remote-study-system/
├── src/
│   ├── components/     # 布局、UI 组件、路由守卫、表单
│   ├── pages/          # 登录/仪表盘/任务/作业/批改/学习路径/技能/设置
│   ├── hooks/          # TanStack Query 与 Realtime hooks
│   ├── services/       # Supabase 数据访问封装（无静态数组）
│   ├── engine/         # 领域引擎（客观题评分/主观题初评/错误分析/学习评估）
│   ├── store/          # Zustand（auth / theme）
│   ├── lib/            # supabase 客户端、env、工具
│   └── types/          # 数据库实体类型
├── supabase/
│   ├── migrations/     # 0001 结构 / 0002 RLS / 0003 存储
│   └── seed.sql        # 测试用户/班级/任务种子数据
└── ai-worker/          # AI Worker（Node.js + TS）
```

## 环境变量

复制 `.env.example` 为 `.env` 并填入：

```env
# 前端可见（浏览器）
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=

# 服务端专用（禁止 VITE_ 前缀，勿进前端）
SUPABASE_URL=
SUPABASE_SECRET_KEY=

# AI Worker
AI_PROVIDER=
AI_API_KEY=
AI_MODEL=
APP_BASE_URL=http://localhost:5173
```

## 本地启动

```bash
# 1. 安装前端依赖
npm install

# 2. 校验（类型 / 规范 / 测试 / 构建）
npm run typecheck
npm run lint
npm run test
npm run build

# 3. 启动开发服务器
npm run dev   # http://localhost:5173
```

### 启动 AI Worker（可选）

```bash
cd ai-worker
npm install
npm run start   # 轮询 ai_jobs 处理 AI 任务
```

## Supabase 初始化

### 方式 A：Supabase CLI（推荐）

```bash
# 安装 CLI 后
supabase login
supabase link --project-ref <your-project-ref>

# 应用迁移（含结构 / RLS / 存储 / Realtime）
supabase db push

# 灌入基础数据（机构 + 科目技能）
supabase db execute --file supabase/seed.sql
# 本地开发亦可：supabase start && supabase db reset（自动执行 migrations + seed）
```

### 方式 B：连接 GitHub 自动部署（生产推荐）

Supabase 项目 → Project Settings → Integrations → GitHub Integration，授权并选择仓库，
Working directory 填 `.`（因 `supabase/` 在仓库根目录）。启用 Deploy to production，
生产分支选 `main`。之后向 `main` 推送新的 `supabase/migrations/*` 会自动部署，
`supabase/config.toml` 声明的 Storage bucket（submissions）也会一并创建。

> 注意：GitHub 部署默认**不会**执行 seed，也**不会**创建可登录的 Auth 用户。

### 创建可登录的测试用户（必需）

直接向 `auth.users` 写数据无法生成可登录账号，测试用户须通过 Admin API 创建：

```bash
# .env 需包含 SUPABASE_URL 与 SUPABASE_SECRET_KEY(service_role)
npm run seed:users
```

脚本会创建 4 个账号、班级"初二(3)班"及示例任务。

### 迁移文件（Supabase 标准时间戳格式）

1. `supabase/migrations/20260710110000_init_schema.sql`
2. `supabase/migrations/20260710110100_rls_policies.sql`
3. `supabase/migrations/20260710110200_storage.sql`
4. `supabase/migrations/20260710110300_realtime.sql`

Realtime 通过第 4 个迁移自动加入 publication，无需手动在 Dashboard 勾选。

## 部署关系

```
GitHub 仓库
├── React 前端  ─────→ Vercel（部署网页）
└── supabase/   ─────→ Supabase（数据库 / Auth / Storage / Realtime / Edge Functions）
```

### Vercel 配置

连接同一 GitHub 仓库，Framework 选 Vite，环境变量只填前端可见项：

```env
VITE_SUPABASE_URL=你的Supabase项目URL
VITE_SUPABASE_PUBLISHABLE_KEY=你的Publishable Key
```

⚠️ Vercel 中**不要**填 `SUPABASE_SECRET_KEY` / `AI_API_KEY`（除非确有服务端函数且明确只跑在服务端）。

## 测试账号（仅本地/staging 使用）

测试账号由 `npm run seed:users` 在**本地或 staging** 环境创建，**不应在生产环境执行**。
密码通过脚本创建，请勿在生产 UI 或公开文档中暴露；生产环境请为管理员设置随机强密码或删除演示账号。

| 角色 | 邮箱 |
|------|------|
| 教师 | teacher@example.com |
| 学生 1 | student1@example.com |
| 学生 2 | student2@example.com |
| 管理员 | admin@example.com |

> 生产部署（Vercel）不会执行 `seed:users`（该命令需 `SUPABASE_SECRET_KEY`，仅本地运行；构建命令为 `npm run build`，与 seed 无关）。

## 已实现的核心闭环

- Supabase Auth 登录 / 退出 / 会话恢复
- 学生自助注册（邀请码加入机构，角色由后端触发器强制为学生，杜绝提权）
- 三角色（teacher / student / admin）+ 机构与班级隔离 + 行级安全（RLS）
- 教师：创建班级 → 创建任务（含题目）→ 分配班级 → 发布 → 查看提交记录 → 在线批改（评分/评语/退回/发布）
- 学生：查看已分配任务 → 创建作业 → 文本作答 → 保存草稿 / 正式提交（版本化）→ 实时状态
- 多主题系统（极简学院 / 深空夜读 / 暖阳自习）+ PWA
- 学习路径规则引擎、科目技能中心、AI Worker 链路骨架

## 安全说明

- 服务端密钥（`SUPABASE_SECRET_KEY` / `AI_API_KEY`）绝不进入前端，`.env` 已被 `.gitignore` 忽略。
- 所有业务数据经 Supabase 查询并由数据库 RLS 强制鉴权；前端传入的 role 不作为权限依据。
- LocalStorage 仅存主题等非敏感 UI 偏好；离线草稿使用 IndexedDB。
