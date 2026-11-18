import { RequestError } from './http.js';

export const defaultModel = 'anthropic/claude-haiku-5.5';

export function createClient({ key, model = defaultModel, fetcher = fetch }) {
  return {
    key,
    async complete(messages, responseFormat, { maxTokens = 1200, effort = 'low', plugins, timeout = 45_000 } = {}) {
      if (!key) throw new RequestError(503, '请在项目的 .env.local 设置 OPENROUTER_API_KEY，然后重启服务。');
      const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          reasoning: { effort, exclude: true },
          response_format: responseFormat,
          ...(plugins ? { plugins } : {})
        }),
        signal: AbortSignal.timeout(timeout)
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        const messages = {
          401: 'OpenRouter 拒绝了 API key，请核对 .env.local 后重启服务。',
          402: 'OpenRouter 账户额度不足。',
          403: /not available in your region/i.test(detail?.error?.message ?? '')
            ? 'OpenRouter 表示当前模型在请求所在地区不可用。'
            : 'OpenRouter 拒绝了这次请求，请检查账户权限。',
          413: '附件太大，模型无法一次读完。',
          429: 'OpenRouter 请求受限，请稍后重试。'
        };
        throw new RequestError(
          response.status === 429 ? 429 : 502,
          messages[response.status] ??
            `OpenRouter 返回 HTTP ${response.status}：${detail?.error?.message ?? '请稍后重试。'}`
        );
      }
      const result = await response.json();
      const reply = result.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new RequestError(502, '模型没有返回回复，请重试。');
      return reply;
    }
  };
}
