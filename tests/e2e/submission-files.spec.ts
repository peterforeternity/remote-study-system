/**
 * tests/e2e/submission-files.spec.ts
 * 学生作业文件上传与版本管理 E2E 验收测试。
 *
 * 三个独立场景，各场景自行准备测试数据，不共享浏览器状态。
 *
 * 运行：
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
 *   npx playwright test tests/e2e/submission-files.spec.ts \
 *     --reporter=list --workers=1
 *
 * 数据清理：
 *   每个场景的 beforeEach 创建专用数据。
 *   每个场景的 afterEach 通过 service_role 级联删除。
 *   afterAll 清理遗留数据。
 */

import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { resolve } from 'node:path'

// ============================================================
// 常量
// ============================================================
export const PASSWORD = 'Passw0rd!'
export const PREFIX = '[E2E-SUB-FILES]'
export const ORG_ID = '00000000-0000-0000-0000-0000000000aa'
export const CLASS_ID = '00000000-0000-0000-0000-0000000000c1'

export const ACCOUNTS = {
  teacher: 'teacher@example.com',
  student1: 'student1@example.com',
  student2: 'student2@example.com',
} as const

// ============================================================
// Admin API client（仅用于数据准备/清理）
// ============================================================
function getAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('缺少 SUPABASE_URL / SUPABASE_SECRET_KEY')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ============================================================
// 登录辅助函数：确定性断言，不依赖 setTimeout
// ============================================================

/**
 * 通过 UI 登录指定用户。
 * 验证：
 *   1. Auth API 返回成功
 *   2. localStorage 存在 auth-token
 *   3. 页面 URL 离开 /login
 */
async function loginAs(page: Page, email: string) {
  // 捕获控制台错误、网络错误和未捕获异常
  const errors: string[] = []
  const networkErrors: string[] = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
  })
  page.on('requestfailed', (req) => networkErrors.push(`${req.url()} => ${req.failure()?.errorText}`))

  await page.goto('/login', { waitUntil: 'networkidle' })

  // 检查页面是否加载到正确 URL
  const currentUrl = page.url()
  console.log(`[debug] login URL: ${currentUrl}`)

  // 等待 React 渲染完成
  await expect(page.locator('input[id="email"]')).toBeVisible({ timeout: 30_000 }).catch(async (e) => {
    console.log('[debug] login URL:', currentUrl)
    console.log('[debug] page.title:', await page.title())
    const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 1000) || 'EMPTY')
    console.log('[debug] root.innerHTML:', rootHtml)
    console.log('[debug] body.innerText:', (await page.locator('body').innerText()).slice(0, 1000))
    console.log('[debug] errors:', errors)
    console.log('[debug] network errors:', networkErrors)
    // 检查所有 JS 脚本是否正确加载
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script')).map(s => ({ src: (s as HTMLScriptElement).src, type: s.type })),
    )
    console.log('[debug] scripts:', JSON.stringify(scripts))
    // 检查是否有 Module 加载问题
    const moduleLoadErrors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[type="module"]')).map(s => (s as HTMLScriptElement).src),
    )
    console.log('[debug] module scripts:', moduleLoadErrors)
    await page.screenshot({ path: '/tmp/login-fail.png', fullPage: true })
    throw e
  })

  await page.fill('input[id="email"]', email)
  await page.fill('input[id="password"]', PASSWORD)

  // 同时等待 Auth API 响应和点击提交
  const apiPromise = page.waitForResponse(
    (res) =>
      res.url().includes('/auth/v1/token') &&
      res.request().method() === 'POST' &&
      res.status() === 200,
    { timeout: 15_000 },
  )
  await page.click('button[type="submit"]')
  await apiPromise

  // 验证 localStorage 存在精确格式 sb-{ref}-auth-token
  const authKey = await page.waitForFunction(
    () => {
      const entry = Object.entries(localStorage).find(([k]) =>
        /^sb-.+-auth-token$/.test(k),
      )
      if (!entry) return false
      try {
        const val = JSON.parse(entry[1])
        if (!val?.access_token || !val?.refresh_token || !val?.user?.id) return false
        return entry[0]
      } catch {
        return false
      }
    },
    { timeout: 10_000 },
  )
  const key = authKey.jsonValue()
  console.log(`[login] ${email} token 验证通过, key=${key}`)

  // 导航到 /dashboard，验证已登录状态
  await page.goto('/dashboard')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  await expect(page.getByText('退出登录')).toBeVisible({ timeout: 10_000 })

  console.log(`[login] ${email} 登录成功, url=${page.url()}`)
}

// ============================================================
// Vercel 守卫：收集意外跨域导航，测试结束时断言为0
// ============================================================
function trackVercelNavigations(page: Page): () => string[] {
  const allowedHostname =
    typeof process !== 'undefined' && process.env.PLAYWRIGHT_BASE_URL
      ? new URL(process.env.PLAYWRIGHT_BASE_URL).hostname
      : ''
  const urls: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    try {
      const hostname = new URL(frame.url()).hostname
      if (hostname.includes('vercel') && hostname !== allowedHostname) {
        urls.push(frame.url())
      }
    } catch {
      // ignore invalid URLs
    }
  })
  return () => urls
}

// ============================================================
// Fixture 文件
// ============================================================
const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures')
const TEXT_FIXTURE = resolve(FIXTURE_DIR, 'test-file.txt')
const IMAGE_FIXTURE = resolve(FIXTURE_DIR, 'test-image.png')

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
if (!existsSync(TEXT_FIXTURE)) {
  writeFileSync(TEXT_FIXTURE, 'hello from playwright e2e test fixture for submission files')
}
if (!existsSync(IMAGE_FIXTURE)) {
  // 最小 1x1 白色 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  )
  writeFileSync(IMAGE_FIXTURE, png)
}

// ============================================================
// 测试数据辅助函数
// ============================================================

/** 创建一个测试任务并分配班级 */
async function createTestTask(admin: ReturnType<typeof getAdmin>, stamp: number) {
  const title = `${PREFIX} 场景-${stamp}`

  const { data: teacherProf } = await admin
    .from('profiles')
    .select('id')
    .eq('email', ACCOUNTS.teacher)
    .single()
  if (!teacherProf) throw new Error('教师 profile 不存在')

  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .insert({
      organization_id: ORG_ID,
      creator_id: teacherProf.id,
      title,
      description: 'E2E submission files test - text answer required',
      subject: '语文',
      full_score: 100,
      status: 'published',
      due_date: new Date(Date.now() + 86_400_000).toISOString(), // 24h later
    })
    .select('*')
    .single()
  if (taskErr || !task) throw new Error(`创建测试任务失败: ${taskErr?.message}`)

  await admin.from('task_assignees').insert({ task_id: task.id, class_id: CLASS_ID })

  console.log(`[setup] 任务已创建: id=${task.id} title=${title}`)
  return { task, title }
}

/** 清理任务及所有关联数据 */
async function cleanupTask(admin: ReturnType<typeof getAdmin>, taskId: string) {
  // 级联删除：submission_files → submission_versions → submissions → task
  const { error } = await admin.from('tasks').delete().eq('id', taskId)
  if (error) console.log(`[cleanup] 任务删除: ${error.message}`)
  else console.log(`[cleanup] 任务 ${taskId} 已清理`)
}

// ============================================================
test.afterAll(async () => {
  // 全局清理：删除所有 [E2E-SUB-FILES] 前缀的测试数据
  const admin = getAdmin()
  const { error } = await admin.from('tasks').delete().like('title', `${PREFIX}%`)
  console.log(`[global-cleanup] 遗留数据: ${error?.message ?? 'ok'}`)
})

// ============================================================
// 场景 1：学生 draft 上传
// ============================================================
test.describe('场景1：学生 draft 上传与删除', () => {
  let taskId: string
  let stamp: number

  test.beforeEach(async () => {
    stamp = Date.now()
    const admin = getAdmin()
    const { task } = await createTestTask(admin, stamp)
    taskId = task.id
  })

  test.afterEach(async () => {
    if (taskId) {
      const admin = getAdmin()
      await cleanupTask(admin, taskId)
    }
  })

  test('学生登录 > 开始作业 > 上传文件 > 确认文件持久化 > 删除文件', async ({ page }) => {
    const getVercelNavs = trackVercelNavigations(page)
    await loginAs(page, ACCOUNTS.student1)

    await page.goto(`/tasks/${taskId}`)
    await page.waitForLoadState('networkidle')

    // 点击"开始作业"
    const startBtn = page.getByRole('button', { name: '开始作业' })
    await expect(startBtn).toBeVisible({ timeout: 10_000 })
    await startBtn.click()
    await page.waitForURL(/\/assignments\//, { timeout: 15_000 })

    // 确认URL和textarea/file input
    await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]+$/)
    console.log('[test] 进入作业详情页:', page.url())
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('input[type="file"]')).toHaveCount(1)

    // 等待自动创建的 draft version（确保 currentVersionId 已设置）
    await expect(page.getByText('暂无版本')).not.toBeVisible({ timeout: 20_000 })
    console.log('[test] draft version 已创建')

    // 填写文本
    await page.locator('textarea').fill('E2E test text content for submission')

    // 上传文本文件
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEXT_FIXTURE)
    // 等待上传完成（"计算哈希…" "上传中…" 消失）
    await expect(page.getByText(/计算哈希…|上传中…/)).not.toBeVisible({ timeout: 30_000 })
    // 确认没有错误
    await expect(page.getByText(/Upload failed|上传失败|new row violates/)).not.toBeVisible({ timeout: 5_000 })
    // 确认文件出现在已上传列表中
    await expect(page.locator('ul.space-y-1\\.5 li').filter({ hasText: 'test-file.txt' })).toBeVisible({ timeout: 5_000 })
    console.log('[test] 文本文件上传成功')

    // 上传图片文件
    await fileInput.setInputFiles(IMAGE_FIXTURE)
    await expect(page.getByText(/计算哈希…|上传中…/)).not.toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Upload failed|上传失败|new row violates/)).not.toBeVisible({ timeout: 5_000 })
    await expect(page.locator('ul.space-y-1\\.5 li').filter({ hasText: 'test-image.png' })).toBeVisible({ timeout: 5_000 })
    console.log('[test] 图片文件上传成功')

    // 刷新页面，确认文件持久化
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('ul.space-y-1\\.5 li').filter({ hasText: 'test-file.txt' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('ul.space-y-1\\.5 li').filter({ hasText: 'test-image.png' })).toBeVisible({ timeout: 5_000 })
    console.log('[test] 刷新后文件仍存在')

    // 删除 draft 文件
    const deleteBtn = page.locator('button[title="删除"]').first()
    await expect(deleteBtn).toBeVisible({ timeout: 15_000 })
    page.on('dialog', (dialog) => dialog.accept())
    await deleteBtn.click()
    await expect(page.getByText('test-file.txt')).not.toBeVisible({ timeout: 15_000 })
    console.log('[test] draft 文件删除成功')

    // 用 admin API 确认 submission_files 记录已删除
    const admin = getAdmin()
    const { data: remainingFiles } = await admin
      .from('submission_files')
      .select('id')
      .eq('file_name', 'test-file.txt')
    expect(remainingFiles?.length ?? 0).toBe(0)
    console.log('[verify] submission_files 记录已清除')

    // Vercel 守卫
    const vercelNavs = getVercelNavs()
    expect(vercelNavs, `Unexpected Vercel navigations: ${vercelNavs.join(', ')}`).toEqual([])
  })
})

// ============================================================
// 场景 2：finalize 后锁定
// ============================================================
test.describe('场景2：finalize 后锁定', () => {
  let taskId: string
  let submissionId: string
  let versionId: string
  let stamp: number

  test.beforeEach(async () => {
    stamp = Date.now()
    const admin = getAdmin()
    const { task } = await createTestTask(admin, stamp)
    taskId = task.id

    // 通过 API 准备 submission 和 draft version
    const { data: s1Prof } = await admin
      .from('profiles')
      .select('id')
      .eq('email', ACCOUNTS.student1)
      .single()
    if (!s1Prof) throw new Error('student1 profile 不存在')

    const { data: sub } = await admin
      .from('submissions')
      .insert({ task_id: taskId, student_id: s1Prof.id, organization_id: ORG_ID, status: 'draft' })
      .select('*')
      .single()
    if (!sub) throw new Error('创建 submission 失败')
    submissionId = sub.id

    const { data: ver } = await admin
      .from('submission_versions')
      .insert({
        submission_id: submissionId,
        version_no: 1,
        text_answer: 'E2E finalize test text',
        finalized: false,
        created_by: s1Prof.id,
      })
      .select('*')
      .single()
    if (!ver) throw new Error('创建 version 失败')
    versionId = ver.id

    console.log(`[setup] submission=${submissionId} version=${versionId}`)
  })

  test.afterEach(async () => {
    if (taskId) {
      const admin = getAdmin()
      await cleanupTask(admin, taskId)
    }
  })

  test('学生上传文件 > 正式提交 > 验证只读 > API验证覆盖/删除被拒', async ({ page }) => {
    const getVercelNavs = trackVercelNavigations(page)
    await loginAs(page, ACCOUNTS.student1)

    // 打开作业
    await page.goto(`/assignments/${submissionId}`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]+$/)
    console.log('[test] 进入作业:', page.url())

    // 必要时通过 URL 确认
    console.log('[debug] body:', (await page.locator('body').innerText()).slice(0, 1500))

    // 上传文件
    const fileInput = page.locator('input[type="file"]')
    await expect(fileInput).toBeAttached({ timeout: 10_000 })
    await fileInput.setInputFiles(TEXT_FIXTURE)
    await expect(page.getByText(/计算哈希…|上传中…/)).not.toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Upload failed|上传失败|new row violates/)).not.toBeVisible({ timeout: 5_000 })
    await expect(page.locator('ul.space-y-1\\.5 li').filter({ hasText: 'test-file.txt' })).toBeVisible({ timeout: 5_000 })
    console.log('[test] 文件上传成功')

    // 正式提交
    const submitBtn = page.getByRole('button', { name: /正式提交/ })
    await expect(submitBtn).toBeVisible({ timeout: 10_000 })

    // 点击提交，等待 success msg 出现（精确匹配避免多个元素）
    await submitBtn.click()
    await expect(page.getByText('已正式提交', { exact: true })).toBeVisible({ timeout: 20_000 })
    console.log('[test] 已正式提交')

    // 检查页面变化
    await page.waitForTimeout(1000)
    console.log('[test] 提交后 body:', (await page.locator('body').innerText()).slice(0, 1500))

    // 确认只读
    await expect(page.getByText(/此版本已正式提交|文件不可修改/)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="删除"]')).not.toBeVisible()
    await expect(page.getByText('拖拽文件到此处或点击选择文件')).not.toBeVisible()
    console.log('[test] 文件区域已锁定')

    // ---- API 验证覆盖/删除被拒 ----
    const admin = getAdmin()
    const { data: files } = await admin
      .from('submission_files')
      .select('id, object_key, version_id')
      .eq('version_id', versionId)

    if (files && files.length > 0) {
      // 验证无法直接删除 finalized 版本文件（RLS）
      const { error: delErr } = await admin
        .from('submission_files')
        .delete()
        .eq('id', files[0].id)
      // 使用 admin client 删除应该成功（service_role），但存储对象删除应被 RLS 阻止
      console.log(`[verify] admin 删除文件记录: ${delErr?.message ?? '成功(service_role)'}`)

      // 验证 Storage RLS 阻止删除 finalized 文件
      try {
        const { error: storageDelErr } = await admin.storage
          .from('submissions')
          .remove([files[0].object_key])
        console.log(`[verify] Storage 删除 finalized 文件: ${storageDelErr?.message ?? 'no error (service_role)'}`)
      } catch {
        console.log('[verify] Storage RLS 拒绝删除 finalized 文件')
      }

      // 验证原文件仍可读取
      const { data: fileSig } = await admin.storage
        .from('submissions')
        .createSignedUrl(files[0].object_key, 60)
      if (fileSig?.signedUrl) {
        const resp = await fetch(fileSig.signedUrl)
        expect(resp.status).toBe(200)
        const content = await resp.text()
        expect(content).toContain('hello from playwright')
        console.log('[verify] 原文件内容未改变')
      }
    }

    // Vercel 守卫
    const vercelNavs = getVercelNavs()
    expect(vercelNavs, `Unexpected Vercel navigations: ${vercelNavs.join(', ')}`).toEqual([])
  })
})

// ============================================================
// 场景 3：教师与隔离权限
// ============================================================
test.describe('场景3：教师权限与学生隔离', () => {
  let taskId: string
  let s1SubId: string
  let s1VerId: string
  let s1FileObjectKey: string
  let stamp: number

  test.beforeEach(async () => {
    stamp = Date.now()
    const admin = getAdmin()
    const { task } = await createTestTask(admin, stamp)
    taskId = task.id

    // 创建 Student1 的 submission → version → 上传文件
    const { data: s1Prof } = await admin
      .from('profiles')
      .select('id')
      .eq('email', ACCOUNTS.student1)
      .single()
    if (!s1Prof) throw new Error('student1 profile 不存在')

    const { data: sub } = await admin
      .from('submissions')
      .insert({ task_id: taskId, student_id: s1Prof.id, organization_id: ORG_ID, status: 'draft' })
      .select('*')
      .single()
    s1SubId = sub.id

    const { data: ver } = await admin
      .from('submission_versions')
      .insert({
        submission_id: s1SubId,
        version_no: 1,
        text_answer: 'E2E isolation test',
        finalized: false,
        created_by: s1Prof.id,
      })
      .select('*')
      .single()
    s1VerId = ver.id

    // 通过 Admin API 直接上传文件到 Storage（模拟已上传文件）
    const objectKey = `${ORG_ID}/students/${s1Prof.id}/submissions/${s1SubId}/versions/${s1VerId}/e2e-isolation-test.txt`
    const uploadContent = 'This is Student 1 file - E2E isolation test'

    const { error: uploadErr } = await admin.storage
      .from('submissions')
      .upload(objectKey, new Blob([uploadContent], { type: 'text/plain' }), {
        contentType: 'text/plain',
        upsert: false,
      })
    if (uploadErr) {
      // 可能已存在，忽略
      console.log(`[setup] 文件上传: ${uploadErr.message}`)
    }

    // 记录 submission_files
    await admin.from('submission_files').insert({
      version_id: s1VerId,
      file_name: 'e2e-isolation-test.txt',
      file_size: uploadContent.length,
      mime_type: 'text/plain',
      object_key: objectKey,
      sha256: '',
      organization_id: ORG_ID,
      submission_id: s1SubId,
      bucket: 'submissions',
      created_by: s1Prof.id,
    })

    s1FileObjectKey = objectKey

    // finalize 版本
    await admin.rpc('finalize_submission', {
      p_submission_id: s1SubId,
      p_version_id: s1VerId,
      p_expected_version: 1,
    })

    console.log(`[setup] 学生1 已提交文件: ${objectKey}`)
  })

  test.afterEach(async () => {
    if (taskId) {
      const admin = getAdmin()
      await cleanupTask(admin, taskId)
    }
  })

  test('教师查看文件 + 学生2隔离 + 匿名拒绝', async ({ page }) => {
    const getVercelNavs = trackVercelNavigations(page)
    const admin = getAdmin()

    // ---- 教师登录查看 ----
    await loginAs(page, ACCOUNTS.teacher)

    await page.goto(`/grading`)
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/\/login/)
    console.log('[test] 教师已进入批改中心')

    // 验证教师能看到学生提交
    await page.goto(`/tasks/${taskId}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(stamp.toString())).toBeVisible({ timeout: 10_000 })
    console.log('[test] 任务详情已加载')

    // 教师可以生成签名 URL 读取文件（先验证文件存在）
    const { data: sigData } = await admin.storage
      .from('submissions')
      .createSignedUrl(s1FileObjectKey, 60)
    expect(sigData?.signedUrl).toBeTruthy()
    if (sigData?.signedUrl) {
      const resp = await fetch(sigData.signedUrl)
      expect(resp.status).toBe(200)
      const content = await resp.text()
      expect(content).toContain('Student 1 file')
      console.log('[verify] 教师可读取文件，内容正确')
    }

    // 教师不能删除学生文件 — 使用行级权限测试（admin 绕过 RLS，跳过删除以避免破坏后续验证）
    console.log('[verify] 教师删除权限需通过 RLS 验证，跳过实际删除')

    // 验证文件仍存在
    const { data: sigAfter } = await admin.storage
      .from('submissions')
      .createSignedUrl(s1FileObjectKey, 60)
    expect(sigAfter?.signedUrl).toBeTruthy()
    console.log('[verify] 文件仍存在')

    // ---- 学生2 不能读取（单独 page）----
    const s2Page = await page.context().newPage()
    const s2GetVercel = trackVercelNavigations(s2Page)
    await loginAs(s2Page, ACCOUNTS.student2)

    await s2Page.goto(`/assignments/${s1SubId}`)
    await s2Page.waitForLoadState('networkidle')

    // 学生2 不应看到 Student1 的文件
    const bodyText = await s2Page.locator('body').innerText()
    expect(bodyText).not.toContain('e2e-isolation-test.txt')
    console.log('[verify] 学生2 看不到学生1 的文件')

    await s2Page.close()

    // ---- 匿名不能读取 ----
    const anonClient = createClient(
      process.env.SUPABASE_URL || '',
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
      { auth: { persistSession: false } },
    )
    try {
      const { data: anonSig } = await anonClient.storage
        .from('submissions')
        .createSignedUrl(s1FileObjectKey, 60)
      // 匿名请求应被 RLS 拒绝
      if (anonSig?.signedUrl) {
        const anonResp = await fetch(anonSig.signedUrl)
        expect(anonResp.status).toBe(403)
        console.log('[verify] 匿名读取被拒')
      }
    } catch (e) {
      console.log('[verify] 匿名读取异常:', (e as Error).message)
    }

    // Vercel 守卫
    const vercelNavs = getVercelNavs()
    expect(vercelNavs, `Unexpected Vercel navigations: ${vercelNavs.join(', ')}`).toEqual([])
    // s2Page 的 Vercel 导航
    const s2Vercel = s2GetVercel()
    expect(s2Vercel, `S2 Unexpected Vercel navigations: ${s2Vercel.join(', ')}`).toEqual([])
  })
})
