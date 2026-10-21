// 1回分のテスト実行。成功・失敗・停止を区別して記録する(失敗を成功扱いしない)。
import { newId } from '../../src/game/save';
import { runChecks } from './checks';
import { callCostUsd, DEFAULT_RATE, priceKnown } from './cost';
import { parseOutput } from './parse';
import { buildMessages, GENERATION_PARAMS, PROMPT_VERSION } from './prompt';
import { buildSentParams, callModel } from './providers';
import type { ModelInfo, RunEnv, RunResult, Scenario } from './types';

export type RunOptions = {
  repeat: number;
  keyFor?: (endpointId: string) => string | undefined;
  verifiedEndpoints?: ReadonlySet<string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  rate?: number;
  mockDelayMs?: number;
  env?: RunEnv; // 実行時の環境の記録(ZDR・メモ)
};

export async function runOne(model: ModelInfo, scenario: Scenario, opts: RunOptions): Promise<RunResult> {
  const messages = buildMessages(scenario);
  const requestedParams = { ...GENERATION_PARAMS };
  const { sent, notes } = buildSentParams(model, requestedParams);
  const outcome = await callModel(model, messages, sent, {
    scenarioId: scenario.id,
    keyFor: opts.keyFor,
    verifiedEndpoints: opts.verifiedEndpoints,
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    mockDelayMs: opts.mockDelayMs,
  });
  const parsed = outcome.status === 'success' ? parseOutput(outcome.output) : undefined;
  // 費用は出力トークン(推論を含む)で計算する。推論トークンを別に足すと二重に数えることになる
  const usd = callCostUsd(model, outcome.usage.inputTokens, outcome.usage.outputTokens);
  return {
    id: newId(),
    createdAt: Date.now(),
    modelKey: model.key,
    modelName: model.displayName,
    apiModelId: model.apiModelId,
    provider: model.provider,
    endpoint: outcome.endpoint,
    servedBy: outcome.servedBy,
    live: model.adapter === 'openai',
    scenarioId: scenario.id,
    track: scenario.track,
    promptVersion: PROMPT_VERSION,
    repeat: opts.repeat,
    status: outcome.status,
    error: outcome.error,
    request: { messages, requestedParams, sentParams: { ...sent, stream: false }, paramNotes: notes },
    output: outcome.output,
    parsed,
    checks: parsed ? runChecks(scenario, outcome.output, parsed) : [],
    latencyMs: outcome.latencyMs,
    usage: outcome.usage,
    price: model.adapter === 'openai' && priceKnown(model)
      ? { inputUsdPerM: model.priceInputUsdPerM as number, outputUsdPerM: model.priceOutputUsdPerM as number, checkedAt: model.priceCheckedAt, source: model.priceSource }
      : undefined,
    costJpy: usd === undefined ? undefined : usd * (opts.rate ?? DEFAULT_RATE),
    env: opts.env,
  };
}
