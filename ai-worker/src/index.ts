/**
 * AI Worker — 轮询 ai_jobs 表，处理 queued 任务。
 *
 * 流程（对应 PRD 阶段 6）：
 *   1. 拉取 queued 任务 → 更新为 running
 *   2. 读取题目与学生答案
 *   3. 客观题走规则引擎；主观题走 LLM Adapter
 *   4. 保存模型/Prompt 版本/Skill 版本/置信度/结果
 *   5. 成功 → succeeded；失败 → failed（保存错误，支持有限重试）
 *   6. 结果写入数据库后由 Supabase Realtime 广播给前端
 *
 * 使用服务端密钥（SUPABASE_SECRET_KEY），拥有绕过 RLS 的服务身份，
 * 但仅操作 AI 相关表，遵循最小权限。
 */
import { createClient } from '@supabase/supabase-js'
import { createLLMAdapter } from './llmAdapter'

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? ''
const POLL_INTERVAL_MS = 3000
const MAX_RETRIES = 3

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY，AI Worker 无法启动。')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})
const llm = createLLMAdapter()

interface AiJobRow {
  id: string
  submission_version_id: string
  organization_id: string
  task_type: 'verification' | 'grading'
  retries: number
}

function normalize(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, '')
}

async function processJob(job: AiJobRow) {
  // 更新为 running
  await supabase.from('ai_jobs').update({ status: 'running' }).eq('id', job.id)

  // 读取版本与作答
  const { data: version } = await supabase
    .from('submission_versions')
    .select('text_answer, submission_id')
    .eq('id', job.submission_version_id)
    .single()

  const { data: submission } = await supabase
    .from('submissions')
    .select('task_id')
    .eq('id', version?.submission_id)
    .single()

  const { data: questions } = await supabase
    .from('task_questions')
    .select('id, type, content, answer_key, score')
    .eq('task_id', submission?.task_id)

  const answer = version?.text_answer ?? ''

  for (const q of questions ?? []) {
    const isObjective = ['single', 'multiple', 'judge', 'blank', 'numeric'].includes(q.type)
    if (isObjective) {
      const correct = normalize(answer).includes(normalize(q.answer_key ?? ''))
      await supabase.from('verification_results').insert({
        ai_job_id: job.id,
        question_id: q.id,
        type: 'objective',
        correct,
        score: correct ? q.score : 0,
        confidence: 1,
        feedback: correct ? '回答正确' : `参考答案：${q.answer_key}`,
      })
    } else {
      const result = await llm.grade({
        prompt: `题目：${q.content}\n学生作答：${answer}\n请给出评价与改进建议。`,
      })
      await supabase.from('ai_model_runs').insert({
        ai_job_id: job.id,
        model_name: result.model,
        prompt: q.content,
        raw_output: result.text,
        tokens_used: result.tokensUsed ?? null,
        confidence: result.confidence,
      })
      await supabase.from('verification_results').insert({
        ai_job_id: job.id,
        question_id: q.id,
        type: 'subjective',
        score: Math.round(q.score * result.confidence),
        confidence: result.confidence,
        feedback: result.text,
      })
    }
  }

  await supabase
    .from('ai_jobs')
    .update({
      status: 'succeeded',
      model_name: llm.model,
      prompt_version: 'v1',
    })
    .eq('id', job.id)

  console.log(`[AI Worker] job ${job.id} 处理完成`)
}

async function poll() {
  const { data: jobs, error } = await supabase
    .from('ai_jobs')
    .select('id, submission_version_id, organization_id, task_type, retries')
    .eq('status', 'queued')
    .limit(5)

  if (error) {
    console.error('轮询失败:', error.message)
    return
  }

  for (const job of (jobs ?? []) as AiJobRow[]) {
    try {
      await processJob(job)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const nextRetries = job.retries + 1
      await supabase
        .from('ai_jobs')
        .update({
          status: nextRetries >= MAX_RETRIES ? 'failed' : 'queued',
          retries: nextRetries,
          error_message: message,
          error_code: 'PROCESS_ERROR',
        })
        .eq('id', job.id)
      console.error(`[AI Worker] job ${job.id} 失败 (retry ${nextRetries}):`, message)
    }
  }
}

async function main() {
  console.log('[AI Worker] 启动，轮询 ai_jobs …')
  // 简单轮询循环；生产可替换为 Supabase PGMQ
  for (;;) {
    await poll()
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

void main()
