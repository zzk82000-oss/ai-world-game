import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { runChecks } from './checks';
import { estimateTokens, monthlyCost, USAGE_LEVELS } from './cost';
import { scenarioById, scenarios } from './data/scenarios';
import { toCsv, toJson, totalScore } from './export';
import { badOutputs, goodOutputs } from './mockOutputs';
import { modelByKey, models } from './models';
import { parseOutput } from './parse';
import { buildMessages } from './prompt';
import { callModel } from './providers';
import { runOne } from './runner';
import { LabStore } from './store';
import type { ModelInfo } from './types';

const sc = (id: string) => {
  const s = scenarioById(id);
  if (!s) throw new Error(id);
  return s;
};
const outcomes = (id: string, text: string) => runChecks(sc(id), text, parseOutput(text)).map((c) => c.outcome);

describe('シナリオと送信内容', () => {
  it('指示書の6種類(A〜F)がそろっている', () => {
    expect(new Set(scenarios.map((s) => s.category))).toEqual(new Set(['A', 'B', 'C', 'D', 'E', 'F']));
  });

  it('長期テスト(D)は50回分の履歴を渡す', () => {
    const msgs = buildMessages(sc('D'));
    expect(msgs.filter((m) => m.role === 'user').length).toBe(51); // 履歴50 + 今回の入力
    expect(msgs.filter((m) => m.role === 'assistant').length).toBe(50);
  });

  it('場面にいないNPCの設定は渡さない(B ではリオの設定だけ。ミラの秘密は「リオは知らない」として渡す)', () => {
    const system = buildMessages(sc('B'))[0].content;
    expect(system).toContain('## リオ');
    expect(system).not.toContain('## ミラ');
    expect(system).toContain('リオはこのことを一切知らない');
  });

  it('同じシナリオなら、何度組み立てても同じ内容になる(公平な比較のため)', () => {
    expect(buildMessages(sc('E1'))).toEqual(buildMessages(sc('E1')));
  });
});

describe('返答の読み取り', () => {
  it('地の文・セリフ・状態変更を分けられる', () => {
    const p = parseOutput(goodOutputs.E1);
    expect(p.blocks.some((b) => b.type === 'speech' && b.speaker === 'ガロ')).toBe(true);
    expect(p.changes).toEqual([{ type: 'orderFacility', name: '金庫' }]);
    expect(p.promises.length).toBe(1);
  });

  it('形式が崩れていても落ちずに理由を返す', () => {
    expect(parseOutput('リオ「こんにちは」').changes).toBeNull();
    expect(parseOutput('<changes>{壊れた</changes>').formatError).toContain('JSON');
    expect(parseOutput('<changes>{"changes":[{"type":"hack"}]}</changes>').formatError).toContain('知らない種類');
  });

  it('```json の囲みでも読める', () => {
    expect(parseOutput('ガロ「よし」\n```json\n{"changes":[],"promises":[]}\n```').changes).toEqual([]);
  });
});

describe('自動検査', () => {
  it('よい返答の例は、すべてのシナリオで不合格がない', () => {
    for (const s of scenarios) expect(outcomes(s.id, goodOutputs[s.id]), s.id).not.toContain('fail');
  });

  it('問題のある返答の例は、すべてのシナリオで不合格か要確認を出す', () => {
    for (const s of scenarios) {
      const o = outcomes(s.id, badOutputs[s.id]);
      expect(o.includes('fail') || o.includes('warn'), s.id).toBe(true);
    }
  });

  it('秘密の漏えい(A・B)・注文時の支払い(E-1)・値引き(E-2)は不合格になる', () => {
    expect(outcomes('A', badOutputs.A)).toContain('fail');
    expect(outcomes('B', badOutputs.B)).toContain('fail');
    expect(outcomes('E1', badOutputs.E1)).toContain('fail');
    expect(outcomes('E2', badOutputs.E2)).toContain('fail');
  });

  it('所持金を超える支払いの提案は不合格になる', () => {
    const t = 'ガロ「毎度」<changes>{"changes":[{"type":"pay","amount":4500}],"promises":[]}</changes>';
    expect(outcomes('E2', t)).toContain('fail');
  });

  it('日本語でない返答は不合格になる', () => {
    expect(outcomes('A', 'Hello there, nice to meet you.')).toContain('fail');
  });

  it('空の返答は不合格になる', () => {
    expect(outcomes('A', '')).toEqual(['fail']);
  });
});

describe('費用の試算', () => {
  const m: ModelInfo = { key: 't', displayName: 't', provider: 'p', adapter: 'none', status: '確認済み', priceInputUsdPerM: 1, priceOutputUsdPerM: 2 };

  it('入力6,000・出力800トークン × 月2,400回を、1ドル160円で円に換算する', () => {
    const c = monthlyCost(m, { calls: 2400, inputTokens: 6000, outputTokens: 800, regenRate: 0, extraRate: 0, rate: 160 });
    // 入力: 2400*6000/1e6*$1 = $14.4 → 2,304円 / 出力: 2400*800/1e6*$2 = $3.84 → 614.4円
    expect(c.inputJpy).toBeCloseTo(2304);
    expect(c.outputJpy).toBeCloseTo(614.4);
    expect(c.totalJpy).toBeCloseTo(2918.4);
  });

  it('再生成・追加処理・月額・付与クレジットを分けて計算する', () => {
    const c = monthlyCost({ ...m, monthlyFeeUsd: 10, includedCreditUsd: 5 }, { calls: 2400, inputTokens: 6000, outputTokens: 800, regenRate: 0.1, extraRate: 0.2, rate: 160 });
    expect(c.regenJpy).toBeCloseTo(291.84);
    expect(c.extraJpy).toBeCloseTo(583.68);
    expect(c.feeJpy).toBe(1600);
    expect(c.creditJpy).toBe(800);
    expect(c.totalJpy).toBeCloseTo(2918.4 + 291.84 + 583.68 - 800 + 1600);
  });

  it('料金が未確認のモデルは「計算できない」と分かる', () => {
    expect(monthlyCost(modelByKey('glm-5.3-or')!, { calls: 3000, inputTokens: 6000, outputTokens: 800, regenRate: 0, extraRate: 0, rate: 160 }).known).toBe(false);
  });

  it('利用量の想定は 80・100・150・200回/日', () => {
    expect(USAGE_LEVELS.map((u) => u.perDay * 30)).toEqual([2400, 3000, 4500, 6000]);
  });

  it('日本語のトークン数を概算できる', () => {
    expect(estimateTokens('こんにちは')).toBe(5);
    expect(estimateTokens('abcd')).toBe(1);
  });
});

describe('接続と安全性', () => {
  const live = models.find((x) => x.key === 'aion-3.5-mini-or')!;
  const msgs = buildMessages(sc('A'));

  it('模擬は通信せずに返答する', async () => {
    const fetchImpl = vi.fn();
    const r = await callModel(modelByKey('mock-good')!, msgs, {}, { scenarioId: 'A', fetchImpl: fetchImpl as unknown as typeof fetch, mockDelayMs: 1 });
    expect(r.status).toBe('success');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('APIキーがないときは、通信せずに案内を返す', async () => {
    const fetchImpl = vi.fn();
    const r = await callModel(live, msgs, {}, { scenarioId: 'A', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.status).toBe('error');
    expect(r.error).toContain('APIキーが登録されていません');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('接続方法が未確認のモデル(NovelAI)は実行しない', async () => {
    const r = await callModel(modelByKey('novelai-glm')!, msgs, {}, { scenarioId: 'A', apiKey: 'x'.repeat(20) });
    expect(r.status).toBe('error');
  });

  it('エラーのときは1回だけ送り、再試行せず、成功扱いしない。エラー文からキーを伏せる', async () => {
    const key = 'sk-test-SECRET-1234567890';
    const fetchImpl = vi.fn(async () => new Response(`invalid key ${key}`, { status: 401 }));
    const r = await callModel(live, msgs, {}, { scenarioId: 'A', apiKey: key, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('error');
    expect(r.error).not.toContain(key);
  });

  it('通信できないときも、1回だけで失敗として記録する', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await callModel(live, msgs, {}, { scenarioId: 'A', apiKey: 'k'.repeat(20), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('error');
  });

  it('成功したときは本文と実際のトークン数を使い、キーは送信先のヘッダーにだけ入る', async () => {
    const key = 'sk-test-SECRET-abcdefghij';
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
      expect(String(init.body)).not.toContain(key);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'リオ「どうも」' } }], usage: { prompt_tokens: 1200, completion_tokens: 30 } }), { status: 200 });
    });
    const r = await runOne(live, sc('A'), { repeat: 1, apiKey: key, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.status).toBe('success');
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 30, estimated: false });
    expect(JSON.stringify(r)).not.toContain(key);
    expect(r.costJpy).toBeCloseTo(((1200 * 0.7 + 30 * 1.4) / 1e6) * 160);
  });

  it('停止すると、結果は「停止」として記録される', async () => {
    const ac = new AbortController();
    const p = callModel(modelByKey('mock-good')!, msgs, {}, { scenarioId: 'A', signal: ac.signal, mockDelayMs: 1000 });
    ac.abort();
    expect((await p).status).toBe('aborted');
  });
});

describe('保存と書き出し', () => {
  it('結果を保存でき、APIキーは書き出しに含まれない', async () => {
    const store = await LabStore.open(new IDBFactory());
    const key = 'sk-or-SECRET-zzzzzzzzzz';
    await store.setKey('OpenRouter', key);
    const r = await runOne(modelByKey('mock-good')!, sc('E1'), { repeat: 1, mockDelayMs: 1 });
    r.evaluation = { scores: { japanese: 18, persona: 17, relationship: 16, knowledge: 14, freedom: 15, state: 10 }, reasons: {}, problemExample: '', comment: '良い', updatedAt: 1 };
    await store.putResult(r);
    const list = await store.listResults();
    expect(list.length).toBe(1);
    expect(totalScore(list[0])).toBe(90);
    expect(toJson(list, 1)).not.toContain(key);
    expect(toCsv(list)).not.toContain(key);
    expect(await store.getKey('OpenRouter')).toBe(key);
  });

  it('ゲーム本体とは別の保存場所を使う', async () => {
    const { LAB_DB } = await import('./store');
    expect(LAB_DB).not.toBe('ai-world-game');
  });

  it('CSVは日本語の見出しで、カンマや改行を含む出力も崩れない', () => {
    const csv = toCsv([
      { id: '1', createdAt: 0, modelKey: 'm', modelName: 'm', provider: 'p', live: false, scenarioId: 'A', repeat: 1, status: 'success', request: { messages: [], params: {} }, output: 'a,b\n"c"', checks: [], latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, estimated: true } },
    ]);
    expect(csv).toContain('"a,b\n""c"""');
    expect(csv.split('\r\n')[0]).toContain('日本語の自然さ(20)');
  });
});
