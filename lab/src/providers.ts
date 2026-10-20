// モデルへの接続。模擬は通信しない。実通信は1回だけ送り、失敗しても自動で再試行しない。
import { estimateTokens } from './cost';
import { badOutputs, goodOutputs } from './mockOutputs';
import type { ChatMessage, ModelInfo } from './types';

export type CallOutcome = {
  status: 'success' | 'error' | 'aborted';
  output: string;
  error?: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; estimated: boolean };
};

export const TIMEOUT_MS = 120_000;

export const estimateInputTokens = (messages: ChatMessage[]) => messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);

// 結果やエラーにAPIキーが紛れ込まないよう、念のため伏せ字にする
export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length >= 8).reduce((t, s) => t.split(s).join('***'), text);
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

type CallOptions = {
  scenarioId: string;
  apiKey?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
  mockDelayMs?: number;
};

export async function callModel(
  model: ModelInfo,
  messages: ChatMessage[],
  params: Record<string, unknown>,
  opts: CallOptions,
): Promise<CallOutcome> {
  const now = opts.now ?? (() => performance.now());
  const start = now();
  const elapsed = () => Math.round(now() - start);
  const inputEstimate = estimateInputTokens(messages);

  if (model.adapter === 'mock-good' || model.adapter === 'mock-bad') {
    try {
      await wait(opts.mockDelayMs ?? 300, opts.signal);
    } catch {
      return { status: 'aborted', output: '', error: '停止しました', latencyMs: elapsed(), usage: { inputTokens: inputEstimate, outputTokens: 0, estimated: true } };
    }
    const table = model.adapter === 'mock-good' ? goodOutputs : badOutputs;
    const output = table[opts.scenarioId] ?? '';
    return { status: 'success', output, latencyMs: elapsed(), usage: { inputTokens: inputEstimate, outputTokens: estimateTokens(output), estimated: true } };
  }

  if (model.adapter !== 'openai' || !model.baseUrl || !model.apiModelId) {
    return { status: 'error', output: '', error: 'このモデルは接続方法が確認できていないため、実行できません', latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
  }
  if (!opts.apiKey) {
    return { status: 'error', output: '', error: `${model.provider} のAPIキーが登録されていません(「設定」で登録できます)`, latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => controller.abort(new DOMException('aborted', 'AbortError')));
  const secrets = [opts.apiKey];
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model: model.apiModelId, messages, ...params, stream: false }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { status: 'error', output: '', error: redact(`HTTP ${res.status}: ${text.slice(0, 500)}`, secrets), latencyMs: elapsed(), usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
    }
    let data: { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      data = JSON.parse(text);
    } catch {
      return { status: 'error', output: '', error: '返答をJSONとして読めませんでした', latencyMs: elapsed(), usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { status: 'error', output: '', error: '返答の本文が空でした', latencyMs: elapsed(), usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
    }
    const output = redact(content, secrets);
    const u = data.usage;
    const real = typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number';
    return {
      status: 'success',
      output,
      error: data.choices?.[0]?.finish_reason === 'length' ? '出力上限で途中終了しました' : undefined,
      latencyMs: elapsed(),
      usage: real
        ? { inputTokens: u!.prompt_tokens as number, outputTokens: u!.completion_tokens as number, estimated: false }
        : { inputTokens: inputEstimate, outputTokens: estimateTokens(output), estimated: true },
    };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const reason = controller.signal.reason as { name?: string } | undefined;
    if (name === 'AbortError' || reason) {
      const timeout = reason?.name === 'TimeoutError';
      return { status: timeout ? 'error' : 'aborted', output: '', error: timeout ? `${TIMEOUT_MS / 1000}秒以内に返答がありませんでした` : '停止しました', latencyMs: elapsed(), usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
    }
    return { status: 'error', output: '', error: redact(`通信できませんでした: ${String((e as Error)?.message ?? e)}`, secrets), latencyMs: elapsed(), usage: { inputTokens: 0, outputTokens: 0, estimated: true } };
  } finally {
    clearTimeout(timer);
  }
}
