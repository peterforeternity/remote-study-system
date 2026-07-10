/**
 * LLM Adapter — 统一大模型调用接口。
 * 密钥仅在服务端读取（AI_API_KEY，无 VITE_ 前缀），绝不进入前端。
 * 第一阶段：提供 mock provider 保证链路可跑；配置真实 provider 后即可切换。
 */

export interface LLMGradeParams {
  prompt: string
  system?: string
}

export interface LLMResult {
  text: string
  model: string
  promptVersion: string
  confidence: number
  tokensUsed?: number
}

export interface LLMAdapter {
  readonly model: string
  grade(params: LLMGradeParams): Promise<LLMResult>
}

const PROMPT_VERSION = 'v1'

/** 占位 provider：无外部依赖，用于本地跑通链路。 */
class MockAdapter implements LLMAdapter {
  readonly model = 'mock-llm'
  async grade(params: LLMGradeParams): Promise<LLMResult> {
    const len = params.prompt.length
    return {
      text: `【AI 初评】已阅读作答（约 ${len} 字）。要点结构基本完整，建议补充推导细节与结论说明。`,
      model: this.model,
      promptVersion: PROMPT_VERSION,
      confidence: 0.55,
    }
  }
}

/** OpenAI 兼容 provider（可对接任意 OpenAI 风格接口）。 */
class OpenAICompatibleAdapter implements LLMAdapter {
  readonly model: string
  constructor(
    private apiKey: string,
    model: string,
    private baseUrl = 'https://api.openai.com/v1',
  ) {
    this.model = model
  }

  async grade(params: LLMGradeParams): Promise<LLMResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: params.system ?? '你是严谨的学科批改助手。' },
          { role: 'user', content: params.prompt },
        ],
        temperature: 0.2,
      }),
    })
    if (!res.ok) {
      throw new Error(`LLM 调用失败: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as {
      choices: { message: { content: string } }[]
      usage?: { total_tokens: number }
    }
    return {
      text: data.choices[0]?.message?.content ?? '',
      model: this.model,
      promptVersion: PROMPT_VERSION,
      confidence: 0.7,
      tokensUsed: data.usage?.total_tokens,
    }
  }
}

/** 依据环境变量创建适配器。 */
export function createLLMAdapter(): LLMAdapter {
  const provider = process.env.AI_PROVIDER
  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL ?? 'gpt-4o-mini'

  if (provider === 'openai' && apiKey) {
    return new OpenAICompatibleAdapter(apiKey, model)
  }
  // 未配置真实模型时使用 mock，保证 Worker 可运行
  return new MockAdapter()
}
