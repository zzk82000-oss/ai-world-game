// モデルへの接続。模擬は通信しない。実通信は許可リストの送信先に1回だけ送り、失敗しても自動で再試行しない。
import { estimateTokens } from './cost';
import { ENDPOINTS, liveBlockReason, SAFE_FETCH } from './endpoints';
import { badOutputs, goodOutputs } from './mockOutputs';
import type { ChatMessage, ModelInfo, Usage } from './types';

export type CallOutcome = {
  status: 'success' | 'error' | 'aborted';
  output: string;
  error?: string;
  latencyMs: number;
  usage: Usage;
  endpoint?: string;
};

export const TIMEOUT_MS = 120_000;

export const estimateInputTokens = (messages: ChatMessage[]) => messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);

// 結果やエラーにAPIキーが紛れ込まないよう、念のため伏せ字にする
export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length >= 8).reduce((t, s) => t.split(s).join('***'), text);
}

// 共通の生成設定から、モデルが対応しない設定を外し、モデル固有の調整を加える。理由も残す
export function buildSentParams(model: ModelInfo, requested: Record<string, unknown>) {
  const sent: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(requested)) {
    const support = model.params?.[k as 'temperature' | 'max_tokens'] ?? '未確認';
    if (support === '非対応') {
      notes.push(`${k} は非対応のため送らない`);
      continue;
    }
    if (support === '未確認') notes.push(`${k} への対応は未確認(指定値のまま送る)`);
    sent[k] = v;
  }
  if (model.paramOverrides) {
    Object.assign(sent, model.paramOverrides.values);
    notes.push(`モデル固有の調整 ${JSON.stringify(model.paramOverrides.values)}: ${model.paramOverrides.reason}`);
  }
  return { sent, notes };
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
  keyFor?: (endpointId: string) => string | undefined; // 送信先ごとのキー(メモリ上にだけある)
  verifiedEndpoints?: ReadonlySet<string>; // この画面で接続確認に成功した送信先
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
  mockDelayMs?: number;
};

const noUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, source: 'estimate' });

export async function callModel(model: ModelInfo, messages: ChatMessage[], sentParams: Record<string, unknown>, opts: CallOptions): Promise<CallOutcome> {
  const now = opts.now ?? (() => performance.now());
  const start = now();
  const elapsed = () => Math.round(now() - start);

  if (model.adapter === 'mock-good' || model.adapter === 'mock-bad') {
    const inputTokens = estimateInputTokens(messages);
    try {
      await wait(opts.mockDelayMs ?? 300, opts.signal);
    } catch {
      return { status: 'aborted', output: '', error: '停止しました', latencyMs: elapsed(), usage: { inputTokens, outputTokens: 0, source: 'estimate' } };
    }
    const table = model.adapter === 'mock-good' ? goodOutputs : badOutputs;
    const output = table[opts.scenarioId] ?? '';
    return { status: 'success', output, latencyMs: elapsed(), usage: { inputTokens, outputTokens: estimateTokens(output), source: 'estimate' } };
  }

  if (model.adapter !== 'openai' || !model.apiModelId || !model.endpointId) {
    return { status: 'error', output: '', error: 'このモデルは接続方法が確認できていないため、実行できません', latencyMs: 0, usage: noUsage() };
  }
  const ep = ENDPOINTS[model.endpointId];
  const blocked = liveBlockReason(ep, opts.verifiedEndpoints ?? new Set());
  if (blocked) return { status: 'error', output: '', error: blocked, latencyMs: 0, usage: noUsage() };
  // キーは送信先ごとに取り出す。別の送信先のキーが使われることはない
  const apiKey = opts.keyFor?.(ep.id);
  if (!apiKey) {
    return { status: 'error', output: '', error: `${ep.provider} のAPIキーが入力されていません(「設定」タブで入力できます。保存はされません)`, latencyMs: 0, usage: noUsage() };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => controller.abort(new DOMException('aborted', 'AbortError')));
  const secrets = [apiKey];
  try {
    const res = await (opts.fetchImpl ?? fetch)(ep.url, {
      ...SAFE_FETCH,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model.apiModelId, messages, ...sentParams, stream: false }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { status: 'error', output: '', error: redact(`HTTP ${res.status}: ${text.slice(0, 500)}`, secrets), latencyMs: elapsed(), usage: noUsage(), endpoint: ep.url };
    }
    let data: {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };
    try {
      data = JSON.parse(text);
    } catch {
      return { status: 'error', output: '', error: '返答をJSONとして読めませんでした', latencyMs: elapsed(), usage: noUsage(), endpoint: ep.url };
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { status: 'error', output: '', error: '返答の本文が空でした', latencyMs: elapsed(), usage: noUsage(), endpoint: ep.url };
    }
    const output = redact(content, secrets);
    const u = data.usage;
    const real = typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number';
    const reasoning = u?.completion_tokens_details?.reasoning_tokens;
    const usage: Usage = real
      ? { inputTokens: u!.prompt_tokens as number, outputTokens: u!.completion_tokens as number, source: 'api', ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}) }
      : { inputTokens: estimateInputTokens(messages), outputTokens: estimateTokens(output), source: 'estimate' };
    return {
      status: 'success',
      output,
      error: data.choices?.[0]?.finish_reason === 'length' ? '出力上限で途中終了しました' : undefined,
      latencyMs: elapsed(),
      usage,
      endpoint: ep.url,
    };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const reason = controller.signal.reason as { name?: string } | undefined;
    if (name === 'AbortError' || reason) {
      const timeout = reason?.name === 'TimeoutError';
      return { status: timeout ? 'error' : 'aborted', output: '', error: timeout ? `${TIMEOUT_MS / 1000}秒以内に返答がありませんでした` : '停止しました', latencyMs: elapsed(), usage: noUsage(), endpoint: ep.url };
    }
    return { status: 'error', output: '', error: redact(`通信できませんでした: ${String((e as Error)?.message ?? e)}`, secrets), latencyMs: elapsed(), usage: noUsage(), endpoint: ep.url };
  } finally {
    clearTimeout(timer);
  }
}
