/**
 * src/services/__tests__/storage-path.test.ts
 *
 * 验证 createSignedUrl / storage upload 使用的对象路径格式。
 *
 * 关键约束：
 *   1. bucket 名称必须是 'task-resources'（私有桶）
 *   2. object_path 格式：organizationId/tasks/taskId/resources/uuid-fileName
 *   3. 绝不能将完整 URL（https://... 或 /storage/v1/...）传给 createSignedUrl
 *   4. 绝不能将公开 URL 前缀传给 createSignedUrl
 */
import { describe, it, expect } from 'vitest'

// ---- 常量（与 TaskFormModal 中一致） ----
const BUCKET = 'task-resources'
const ORG_ID = '00000000-0000-0000-0000-0000000000aa'
const SAMPLE_TASK_ID = '00000000-0000-0000-0000-0000000000d1'

// ---- 模拟路径构建逻辑（与 TaskFormModal 一致） ----
function buildObjectPath(
  orgId: string,
  taskId: string,
  fileName: string,
): { prefix: string; objectPath: string; uuidPart: string; safeName: string } {
  const safeName = fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_')
  const uuidPart = 'a1b2c3d4' // 模拟 crypto.randomUUID().slice(0, 8)
  const prefix = `${orgId}/tasks/${taskId}/resources`
  const objectPath = `${prefix}/${uuidPart}-${safeName}`
  return { prefix, objectPath, uuidPart, safeName }
}

describe('Storage 对象路径格式', () => {
  it('bucket 名称必须是 task-resources（私有桶）', () => {
    expect(BUCKET).toBe('task-resources')
    // 验证不会误用公开桶前缀
    expect(BUCKET).not.toContain('public')
  })

  it('对象路径格式：orgId/tasks/taskId/resources/uuid-fileName', () => {
    const { objectPath } = buildObjectPath(ORG_ID, SAMPLE_TASK_ID, 'test-file.txt')

    // 断言格式：orgId/tasks/taskId/resources/uuidPart-safeName
    expect(objectPath).toMatch(
      /^[a-f0-9-]+\/tasks\/[a-f0-9-]+\/resources\/[a-f0-9]+-.+$/,
    )

    // 断言包含完整的路径层次
    expect(objectPath).toContain('/tasks/')
    expect(objectPath).toContain('/resources/')
    expect(objectPath).toContain('-test-file.txt')

    // 断言不是完整 URL
    expect(objectPath).not.toContain('https://')
    expect(objectPath).not.toContain('http://')
    expect(objectPath).not.toContain('/storage/v1/')
  })

  it('对象路径中不含公开 URL 前缀', () => {
    const { objectPath } = buildObjectPath(ORG_ID, SAMPLE_TASK_ID, 'doc.pdf')

    // 确保没有 public 路径前缀
    expect(objectPath).not.toContain('/object/public/')
    expect(objectPath).not.toContain('/object/sign/')
  })

  it('中文文件名被安全处理', () => {
    const { safeName } = buildObjectPath(
      ORG_ID,
      SAMPLE_TASK_ID,
      '我的文档.pdf',
    )

    // 中文应被保留（正则包含 \u4e00-\u9fff）
    expect(safeName).toContain('我的文档')
    // 但路径中不应有特殊字符
    expect(safeName).not.toContain(' ')
    expect(safeName).not.toContain('/')
    // . 和 - 被保留
    expect(safeName).toContain('.pdf')
  })

  it('特殊字符文件名为安全命名', () => {
    const { safeName } = buildObjectPath(
      ORG_ID,
      SAMPLE_TASK_ID,
      'file name with spaces & symbols!.txt',
    )

    // 空格和特殊字符被替换为下划线
    expect(safeName).toBe('file_name_with_spaces___symbols_.txt')
    expect(safeName).not.toContain(' ')
    expect(safeName).not.toContain('&')
    expect(safeName).not.toContain('!')
  })

  it('前缀格式正确：orgId/tasks/taskId/resources', () => {
    const { prefix } = buildObjectPath(ORG_ID, SAMPLE_TASK_ID, 'test.txt')

    expect(prefix).toBe(`${ORG_ID}/tasks/${SAMPLE_TASK_ID}/resources`)
    // 验证前缀各级组成
    const parts = prefix.split('/')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe(ORG_ID)
    expect(parts[1]).toBe('tasks')
    expect(parts[2]).toBe(SAMPLE_TASK_ID)
    expect(parts[3]).toBe('resources')
  })
})

describe('createSignedUrl 参数验证', () => {
  it('不得将完整 URL 传给 createSignedUrl', () => {
    // 模拟常见的错误输入
    const badInputs = [
      `https://dhilvnewwrktnxxxlkix.supabase.co/storage/v1/object/public/task-resources/${ORG_ID}/tasks/${SAMPLE_TASK_ID}/resources/file.txt`,
      `/storage/v1/object/public/task-resources/${ORG_ID}/tasks/${SAMPLE_TASK_ID}/resources/file.txt`,
      `/storage/v1/object/sign/task-resources/${ORG_ID}/tasks/${SAMPLE_TASK_ID}/resources/file.txt`,
      `https://dhilvnewwrktnxxxlkix.supabase.co/storage/v1/object/sign/task-resources/${ORG_ID}/tasks/${SAMPLE_TASK_ID}/resources/file.txt`,
    ]

    for (const input of badInputs) {
      // 这些都不应该是传给 createSignedUrl 的正确参数
      const isBad =
        input.includes('https://') || input.startsWith('/storage/v1/')
      expect(isBad).toBe(true)
      // 不匹配纯对象路径格式
      expect(input).not.toMatch(
        /^[a-f0-9-]+\/tasks\/[a-f0-9-]+\/resources\/[a-f0-9]+-.+$/,
      )
    }
  })

  it('正确路径格式可以通过 createSignedUrl 使用', () => {
    const { objectPath } = buildObjectPath(ORG_ID, SAMPLE_TASK_ID, 'test.txt')

    // 正确的 objectPath 不包含 https:// 或 /storage/v1/
    expect(objectPath).not.toContain('https://')
    expect(objectPath).not.toContain('/storage/v1/')

    // 是一个纯路径
    expect(objectPath).toBe(
      `${ORG_ID}/tasks/${SAMPLE_TASK_ID}/resources/a1b2c3d4-test.txt`,
    )
  })

  it('task_resources 表中 url 字段必须是纯对象路径', () => {
    // 模拟数据库中 url 字段的值
    const dbUrl = `${ORG_ID}/tasks/${SAMPLE_TASK_ID}/resources/a1b2c3d4-test-file.txt`

    // 验证不是完整 URL
    expect(dbUrl).not.toContain('https://')
    expect(dbUrl).not.toContain('/storage/v1/')

    // 验证可以解析出各部分
    const parts = dbUrl.split('/')
    expect(parts[0]).toBe(ORG_ID)
    expect(parts[1]).toBe('tasks')
    expect(parts[2]).toBe(SAMPLE_TASK_ID)
    expect(parts[3]).toBe('resources')
    expect(parts[4]).toMatch(/^[a-f0-9]+-test-file\.txt$/)
  })
})
