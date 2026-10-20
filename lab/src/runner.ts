// 1回分のテスト実行。成功・失敗・停止を区別して記録する(失敗を成功扱いしない)。
import { newId } from '../../src/game/save';
import { runChecks } from './checks';
import { callCostUsd, DEFAULT_RATE } from './cost';
import { parseOutput } from './parse';
import { buildMessages, GENERATION_PARAMS } from './prompt';
import { callModel } from './providers';
import type { ModelInfo, RunResult, Scenario } from './types';

export type RunOptions = {
  repeat: number;
  apiKey?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  rate?: number;
  mockDelayMs?: number;
};

export async function runOne(model: ModelInfo, scenario: Scenario, opts: RunOptions): Promise<RunResult> {
  const messages = buildMessages(scenario);
  const params = { ...GENERATION_PARAMS };
  const outcome = await callModel(model, messages, params, {
    scenarioId: scenario.id,
    apiKey: opts.apiKey,
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    mockDelayMs: opts.mockDelayMs,
  });
  const live = model.adapter === 'openai';
  const parsed = outcome.status === 'success' ? parseOutput(outcome.output) : undefined;
  const usd = callCostUsd(model, outcome.usage.inputTokens, outcome.usage.outputTokens);
  return {
    id: newId(),
    createdAt: Date.now(),
    modelKey: model.key,
    modelName: model.displayName,
    apiModelId: model.apiModelId,
    provider: model.provider,
    live,
    scenarioId: scenario.id,
    repeat: opts.repeat,
    status: outcome.status,
    error: outcome.error,
    request: { messages, params },
    output: outcome.output,
    parsed,
    checks: parsed ? runChecks(scenario, outcome.output, parsed) : [],
    latencyMs: outcome.latencyMs,
    usage: outcome.usage,
    costJpy: usd === undefined ? undefined : usd * (opts.rate ?? DEFAULT_RATE),
  };
}
