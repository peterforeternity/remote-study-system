/**
 * tests/e2e/public-storage.spec.ts
 * Storage 公网 E2E 验收测试。
 *
 * 使用 Playwright 对生产地址执行真实浏览器测试，
 * 覆盖教师上传、学生下载、未分配拦截、匿名拦截全场景。
 *
 * 运行：npx playwright test tests/e2e/public-storage.spec.ts
 *
 * 数据清理：所有测试数据使用 [E2E-STORAGE] 前缀，
 * 在 afterAll 中通过 service_role 级联清理。
 */
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// ---- 常量 ----
const PASSWORD = 'Passw0rd!'
const PREFIX = '[E2E-STORAGE]'
const ORG_ID = '00000000-0000-0000-0000-0000000000aa'
const FIXTURE = 'tests/fixtures/test-file.txt'

const ACCOUNTS = {
  teacher: 'teacher@example.com',
  student1: 'student1@example.com',
  unassigned: 'student-unassigned@example.com',
}

// ---- Admin API（仅用于数据准备与清理，不参与业务断言） ----
function getAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('缺少 SUPABASE_URL / SUPABASE_SECRET_KEY')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ---- 共享状态（跨 test 传递） ----
const state: {
  taskId: string | null
  taskTitle: string
  objectPath: string | null
  unassignedUserId: string | null
} = {
  taskId: null,
  taskTitle: '',
  objectPath: null,
  unassignedUserId: null,
}

// ============================================================
test.describe.serial('Storage E2E 公网验收', () => {
  // ---------- 前置：创建未分配学生账号 ----------
  test.beforeAll(async () => {
    const stamp = Date.now()
    state.taskTitle = `${PREFIX} 文件上传验收-${stamp}`

    const admin = getAdmin()

    // 创建 unassigned 测试学生（不加入任何班级）
    const { data: newUser, error: createErr } =
      await admin.auth.admin.createUser({
        email: ACCOUNTS.unassigned,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { name: '未分配测试学生' },
      })

    if (createErr && !/already.*(?:registered|exists)/i.test(createErr.message)) {
      throw new Error(`创建未分配学生失败: ${createErr.message}`)
    }

    let uid = newUser?.user?.id
    if (!uid) {
      const { data: list } = await admin.auth.admin.listUsers()
      uid = list.users.find((u) => u.email === ACCOUNTS.unassigned)?.id
    }
    if (!uid) throw new Error('无法获取未分配学生 ID')
    state.unassignedUserId = uid

    // 确保 profile 存在
    await admin.from('profiles').upsert(
      {
        id: uid,
        organization_id: ORG_ID,
        name: '未分配测试学生',
        role: 'student',
        email: ACCOUNTS.unassigned,
      },
      { onConflict: 'id' },
    )

    console.log(`[setup] 未分配学生已就绪: ${uid}`)
  })

  // ---------- 后置：清理所有测试数据 ----------
  test.afterAll(async () => {
    const admin = getAdmin()
    console.log('[cleanup] 开始清理 [E2E-STORAGE] 数据…')

    // 清理本次创建的任务（级联删除 task_questions / task_resources / task_assignees 等）
    if (state.taskId) {
      const { error } = await admin.from('tasks').delete().eq('id', state.taskId)
      console.log(`[cleanup] 任务 ${state.taskId}: ${error?.message ?? 'ok'}`)
    }

    // 清理 Storage 中的测试文件
    if (state.objectPath) {
      try {
        await admin.storage.from('task-resources').remove([state.objectPath])
        console.log(`[cleanup] Storage 文件: ${state.objectPath}`)
      } catch {
        console.log(`[cleanup] Storage 文件可能已不存在`)
      }
    }

    // 清理所有 [E2E-STORAGE] 遗留数据
    const { error: staleErr } = await admin
      .from('tasks')
      .delete()
      .like('title', `${PREFIX}%`)
    console.log(
      `[cleanup] 遗留 [E2E-STORAGE] 任务: ${staleErr?.message ?? 'ok'}`,
    )

    // 清理未分配学生（先删 profile，再删 auth user）
    if (state.unassignedUserId) {
      await admin.from('profiles').delete().eq('id', state.unassignedUserId)
      try {
        await admin.auth.admin.deleteUser(state.unassignedUserId)
        console.log(`[cleanup] 未分配学生已删除: ${state.unassignedUserId}`)
      } catch {
        console.log(`[cleanup] auth user 删除跳过`)
      }
    }

    console.log('[cleanup] 完成')
  })

  // ==========================================================
  //  教师端：创建任务 → 上传文件 → 发布 → 验证
  // ==========================================================
  test('1. 教师创建任务并上传文件', async ({ page }) => {
    // 登录
    await page.goto('/login')
    await page.fill('input[type="email"]', ACCOUNTS.teacher)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')

    // 验证登录成功（不跳回登录页）
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/dashboard/)

    // 进入任务管理页
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: '任务管理' })).toBeVisible()

    // 点击"新建任务"
    await page.click('button:has-text("新建任务")')

    // 等待弹窗出现
    await expect(page.getByText('创建学习任务')).toBeVisible()

    // 填写任务信息
    await page.fill('input[name="title"]', state.taskTitle)
    await page.fill('input[name="subject"]', '数学')

    // 选择班级：初二(3)班
    await page.selectOption('select[name="classId"]', {
      label: '初二(3)班',
    })

    // 上传文件（隐藏的 file input 可直接 setInputFiles）
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(FIXTURE)

    // 验证文件出现在上传列表中
    await expect(page.getByText('test-file.txt')).toBeVisible()

    // 提交：创建草稿
    await page.click('button[type="submit"]')

    // 等待弹窗关闭（任务创建成功后会 onClose）
    await expect(page.getByText('创建学习任务')).not.toBeVisible({
      timeout: 20_000,
    })

    // 返回任务列表，确认出现了刚创建的任务
    await expect(page.getByText(state.taskTitle)).toBeVisible({ timeout: 15_000 })

    // 从页面中提取任务 ID（点击任务标题进入详情再取 URL）
    await page.click(`text=${state.taskTitle}`)
    await page.waitForURL(/\/tasks\//)
    const url = page.url()
    const match = url.match(/\/tasks\/([a-f0-9-]+)/)
    if (!match) throw new Error('无法从 URL 提取任务 ID')
    state.taskId = match[1]
    console.log(`[test] 任务 ID: ${state.taskId}`)

    // 验证任务详情页显示"相关资源"
    await expect(page.getByText('相关资源')).toBeVisible()

    // 验证文件资源名称可见
    await expect(page.getByText('test-file.txt')).toBeVisible({ timeout: 10_000 })

    // 返回任务列表，发布任务
    await page.goto('/tasks')

    // 找到刚创建的任务行，点击"发布"
    const taskRow = page.locator('li', { hasText: state.taskTitle })
    await expect(taskRow).toBeVisible()
    await taskRow.locator('button:has-text("发布")').click()

    // 等待发布完成（状态徽标从"草稿"变为"已发布"）
    await expect(taskRow.getByText('已发布')).toBeVisible({ timeout: 10_000 })
  })

  test('2. 教师验证上传文件：数据库 object_path 格式正确', async () => {
    if (!state.taskId) throw new Error('taskId 未设置')

    const admin = getAdmin()

    // 查询 task_resources，验证 url 字段是纯对象路径而非完整 URL
    const { data: resources, error } = await admin
      .from('task_resources')
      .select('*')
      .eq('task_id', state.taskId)
      .eq('type', 'file')

    expect(error).toBeNull()
    expect(resources).toBeDefined()
    expect(resources!.length).toBeGreaterThanOrEqual(1)

    const fileRec = resources!.find((r) => r.title === 'test-file.txt')
    expect(fileRec).toBeDefined()

    const url = fileRec!.url as string
    console.log(`[verify] task_resources.url = "${url}"`)

    // 断言：url 是纯对象路径，不能是完整 URL
    expect(url).not.toContain('https://')
    expect(url).not.toContain('http://')
    expect(url).not.toContain('/storage/v1/object/public/')
    expect(url).not.toContain('/storage/v1/object/sign/')

    // 断言：url 格式为 organizationId/tasks/taskId/resources/uuid-fileName
    expect(url).toMatch(
      new RegExp(
        `^${ORG_ID}/tasks/${state.taskId}/resources/[a-f0-9]+-test-file\\.txt$`,
      ),
    )

    state.objectPath = url
    console.log(`[verify] object_path = "${state.objectPath}"`)
  })

  test('3. 教师验证：Storage 中文件存在且签名 URL 可访问', async () => {
    if (!state.objectPath) throw new Error('objectPath 未设置')

    const admin = getAdmin()

    // 验证 storage.objects 存在该文件
    const { data: signed, error } = await admin.storage
      .from('task-resources')
      .createSignedUrl(state.objectPath, 300)

    expect(error).toBeNull()
    expect(signed?.signedUrl).toBeDefined()

    // 验证签名 URL 返回 HTTP 200
    const resp = await fetch(signed!.signedUrl)
    expect(resp.status).toBe(200)

    const body = await resp.text()
    expect(body).toContain('hello from playwright e2e test fixture')
  })

  // ==========================================================
  //  已分配学生：查看任务 → 下载文件
  // ==========================================================
  test('4. 已分配学生：任务列表中可见任务', async ({ page }) => {
    if (!state.taskId) throw new Error('taskId 未设置')

    await page.goto('/login')
    await page.fill('input[type="email"]', ACCOUNTS.student1)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')

    await expect(page).not.toHaveURL(/\/login/)

    // 学生进入"我的作业"
    await page.goto('/assignments')
    await expect(page.getByRole('heading', { name: '我的作业' })).toBeVisible()

    // 验证任务出现在列表中
    await expect(page.getByText(state.taskTitle)).toBeVisible({ timeout: 15_000 })
  })

  test('5. 已分配学生：任务详情中可见文件资源', async ({ page }) => {
    if (!state.taskId) throw new Error('taskId 未设置')

    // 确保已登录 student1
    await page.goto('/login')
    await page.fill('input[type="email"]', ACCOUNTS.student1)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')
    await expect(page).not.toHaveURL(/\/login/)

    // 直接访问任务详情
    await page.goto(`/tasks/${state.taskId}`)
    await page.waitForLoadState('networkidle')

    // 确认已加载完毕（不应显示加载中）
    await expect(page.getByText('加载中…')).not.toBeVisible({ timeout: 10_000 })

    // 应显示任务标题
    await expect(page.getByText(state.taskTitle)).toBeVisible({ timeout: 15_000 })

    // 验证"相关资源"区域存在
    await expect(page.getByText('相关资源')).toBeVisible()

    // 验证文件资源名称可见
    await expect(page.getByText('test-file.txt')).toBeVisible({ timeout: 10_000 })

    // 验证不出现"无权访问"文字
    await expect(page.getByText('任务不存在或无权访问')).not.toBeVisible()
  })

  test('6. 已分配学生：签名 URL 返回 HTTP 200', async () => {
    if (!state.objectPath) throw new Error('objectPath 未设置')

    // 使用 anon key + student1 登录态生成签名 URL
    const anonClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    )

    await anonClient.auth.signInWithPassword({
      email: ACCOUNTS.student1,
      password: PASSWORD,
    })

    const { data: signed, error } = await anonClient.storage
      .from('task-resources')
      .createSignedUrl(state.objectPath, 300)

    expect(error).toBeNull()
    expect(signed?.signedUrl).toBeDefined()

    const resp = await fetch(signed!.signedUrl)
    expect(resp.status).toBe(200)

    const body = await resp.text()
    expect(body).toContain('hello from playwright e2e test fixture')
    console.log('[verify] 已分配学生 签名 URL HTTP 200 ✓')
  })

  test('7. 已分配学生：页面中不出现永久公开 URL', async ({ page }) => {
    if (!state.taskId) throw new Error('taskId 未设置')

    // 登录 student1
    await page.goto('/login')
    await page.fill('input[type="email"]', ACCOUNTS.student1)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')
    await expect(page).not.toHaveURL(/\/login/)

    await page.goto(`/tasks/${state.taskId}`)

    // 获取页面所有链接
    const links = await page.locator('a[href]').evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).href),
    )

    // 断言：不存在 /storage/v1/object/public/ 链接
    const publicUrls = links.filter((l) =>
      l.includes('/storage/v1/object/public/'),
    )
    expect(publicUrls.length).toBe(0)
    console.log('[verify] 页面中无公开 Storage URL ✓')
  })

  // ==========================================================
  //  未分配学生：访问拒绝
  // ==========================================================
  test('8. 未分配学生：仪表盘看不到该任务', async ({ page }) => {
    if (!state.taskId) throw new Error('taskId 未设置')

    await page.goto('/login')
    await page.fill('input[type="email"]', ACCOUNTS.unassigned)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')

    await expect(page).not.toHaveURL(/\/login/)

    // 进入"我的作业"
    await page.goto('/assignments')
    await expect(page.getByRole('heading', { name: '我的作业' })).toBeVisible()

    // 验证任务不出现在列表中
    await expect(page.getByText(state.taskTitle)).not.toBeVisible({ timeout: 10_000 })
  })

  test('9. 未分配学生：直接访问任务 URL 显示无权访问', async ({ page }) => {
    if (!state.taskId) throw new Error('taskId 未设置')

    // 登录未分配学生
    await page.goto('/login')
    await page.fill('input[type="email"]', ACCOUNTS.unassigned)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')
    await expect(page).not.toHaveURL(/\/login/)

    // 直接访问任务详情
    await page.goto(`/tasks/${state.taskId}`)

    // 验证显示无权访问提示
    await expect(page.getByText('任务不存在或无权访问')).toBeVisible({
      timeout: 10_000,
    })

    // 验证不显示任务标题和文件
    await expect(page.getByText(state.taskTitle)).not.toBeVisible()
    await expect(page.getByText('test-file.txt')).not.toBeVisible()
  })

  test('10. 未分配学生：无法读取 task_resources', async () => {
    if (!state.taskId) throw new Error('taskId 未设置')

    const anonClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    )

    await anonClient.auth.signInWithPassword({
      email: ACCOUNTS.unassigned,
      password: PASSWORD,
    })

    const { data, error } = await anonClient
      .from('task_resources')
      .select('*')
      .eq('task_id', state.taskId)

    // RLS 应阻止未分配学生读取：返回空数组
    expect(error).toBeNull()
    expect(data).toEqual([])
    console.log('[verify] 未分配学生 task_resources 返回空 ✓')
  })

  test('11. 未分配学生：无法生成文件签名 URL', async () => {
    if (!state.objectPath) throw new Error('objectPath 未设置')

    const anonClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    )

    await anonClient.auth.signInWithPassword({
      email: ACCOUNTS.unassigned,
      password: PASSWORD,
    })

    const { error } = await anonClient.storage
      .from('task-resources')
      .createSignedUrl(state.objectPath, 60)

    expect(error).toBeDefined()
    console.log(`[verify] 未分配学生签名被拒: ${error!.message} ✓`)
  })

  // ==========================================================
  //  匿名用户：拦截
  // ==========================================================
  test('12. 匿名用户：访问任务列表跳转登录页', async ({ page }) => {
    // 不登录
    await page.goto('/assignments')
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })

  test('13. 匿名用户：访问任务详情跳转登录页', async ({ page }) => {
    if (!state.taskId) throw new Error('taskId 未设置')

    await page.goto(`/tasks/${state.taskId}`)
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })

  test('14. 匿名用户：公开 Storage URL 无法读取文件', async () => {
    if (!state.objectPath) throw new Error('objectPath 未设置')

    const anonClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    )

    // 尝试获取公开 URL（私有桶应返回 4xx）
    const { data: urlData } = anonClient.storage
      .from('task-resources')
      .getPublicUrl(state.objectPath)

    const resp = await fetch(urlData.publicUrl)
    expect(resp.status).toBeGreaterThanOrEqual(400)
    expect(resp.status).toBeLessThan(500)
    console.log(`[verify] 公开 URL 返回 ${resp.status}（预期 4xx）✓`)
  })

  test('15. 匿名用户：不存在 service_role 泄露', async ({ page }) => {
    // 验证前端页面源码中不包含 service_role 密钥
    await page.goto('/login')

    const pageContent = await page.content()
    const secretKey = process.env.SUPABASE_SECRET_KEY

    if (secretKey) {
      expect(pageContent).not.toContain(secretKey)
    }
    // 同时确认不含常见的密钥前缀
    expect(pageContent).not.toContain('sb_secret_')

    console.log('[verify] 前端页面无 service_role 泄露 ✓')
  })
})
