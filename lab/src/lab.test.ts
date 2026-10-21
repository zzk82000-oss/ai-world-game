import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { runChecks } from './checks';
import { estimateTokens, measuredUsage, monthlyCost, USAGE_LEVELS } from './cost';
import { scenarioById, scenarios } from './data/scenarios';
import { checkBrowserAccess, ENDPOINTS, liveBlockReason, validateEndpoint, type Endpoint } from './endpoints';
import { comparisonKind, hasSerious, seriousLabels, toCsv, toJson, totalScore } from './export';
import { badOutputs, goodOutputs } from './mockOutputs';
import { modelByKey, models } from './models';
import { parseOutput } from './parse';
import { buildMessages, PROMPT_VERSION } from './prompt';
import { buildSentParams, callModel } from './providers';
import { runOne } from './runner';
import { LAB_DB, LabStore } from './store';
import type { ModelInfo, RunResult } from './types';

const sc = (id: string) => {
  const s = scenarioById(id);
  if (!s) throw new Error(id);
  return s;
};
const checks = (id: string, text: string) => runChecks(sc(id), text, parseOutput(text));
const mechFails = (id: string, text: string) => checks(id, text).filter((c) => c.basis === 'mechanical' && c.outcome === 'fail');
const warns = (id: string, text: string) => checks(id, text).filter((c) => c.outcome === 'warn');

const VERIFIED = new Set(['openrouter', 'venice']);
const aion = modelByKey('aion-3.5-mini-or')!;
const okResponse = (content = 'リオ「どうも」', usage: object = { prompt_tokens: 1200, completion_tokens: 30 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });

describe('シナリオと送信内容', () => {
  it('指示書の6種類(A〜F)がそろい、B は通常(B1)と耐性テスト(B2)に分かれている', () => {
    expect(new Set(scenarios.map((s) => s.category))).toEqual(new Set(['A', 'B', 'C', 'D', 'E', 'F']));
    expect(sc('B1').track).toBe('standard');
    expect(sc('B2').track).toBe('stress');
    expect(scenarios.filter((s) => s.track === 'standard').map((s) => s.id)).toEqual(['A', 'B1', 'C', 'D', 'E1', 'E2', 'F']);
  });

  it('B1 はミラの秘密をAIに渡さない。B2 は「リオは知らない」と明示して渡す', () => {
    const b1 = JSON.stringify(buildMessages(sc('B1')));
    const b2 = JSON.stringify(buildMessages(sc('B2')));
    for (const w of ['貴族', '家出']) expect(b1).not.toContain(w);
    expect(b2).toContain('貴族');
    expect(b2).toContain('リオはこのことを一切知らない');
  });

  it('長期テスト(D)は50回分の履歴を渡す。「50回会話を続けるテストではない」と明記している', () => {
    const msgs = buildMessages(sc('D'));
    expect(msgs.filter((m) => m.role === 'user').length).toBe(51);
    expect(msgs.filter((m) => m.role === 'assistant').length).toBe(50);
    expect(sc('D').note).toContain('異なります');
  });

  it('場面にいないNPCの設定は渡さない。同じシナリオなら毎回同じ内容になる', () => {
    expect(buildMessages(sc('B1'))[0].content).not.toContain('## ミラ');
    expect(buildMessages(sc('E1'))).toEqual(buildMessages(sc('E1')));
  });
});

describe('指示文の版', () => {
  it('v2 は「必ず日本語で書く」を含み、全シナリオ・全モデルに同じ指示文を使う', () => {
    expect(PROMPT_VERSION).toBe(2);
    for (const s of scenarios) expect(buildMessages(s)[0].content).toContain('必ず日本語で書く');
  });

  it('結果に指示文の版を記録し、CSVにも出す。版の記録がない古い結果は v1 として扱う', async () => {
    const r = await runOne(modelByKey('mock-good')!, sc('A'), { repeat: 1, mockDelayMs: 1 });
    expect(r.promptVersion).toBe(2);
    const old = { ...r, promptVersion: undefined };
    const csv = toCsv([r, old]).split('\r\n');
    const col = csv[0].split(',').indexOf('指示文の版');
    expect(csv[1].split(',')[col]).toBe('v2');
    expect(csv[2].split(',')[col]).toBe('v1');
  });
});

describe('返答の読み取り', () => {
  it('地の文・セリフ・状態変更を分けられる', () => {
    const p = parseOutput(goodOutputs.E1);
    expect(p.blocks.some((b) => b.type === 'speech' && b.speaker === 'ガロ')).toBe(true);
    expect(p.changes).toEqual([{ type: 'orderFacility', name: '金庫' }]);
  });

  it('形式が崩れていても落ちずに理由を返す', () => {
    expect(parseOutput('リオ「こんにちは」').changes).toBeNull();
    expect(parseOutput('<changes>{壊れた</changes>').formatError).toContain('JSON');
    expect(parseOutput('<changes>{"changes":[{"type":"hack"}]}</changes>').formatError).toContain('知らない種類');
  });
});

describe('自動検査(補助評価)', () => {
  it('すべての検査に「確定(mechanical)」か「疑い(heuristic)」の区別が付く', () => {
    for (const s of scenarios) for (const c of checks(s.id, badOutputs[s.id])) expect(['mechanical', 'heuristic']).toContain(c.basis);
  });

  it('語句による検査は、語が見つかっても「不合格」にせず「要確認」にする', () => {
    for (const s of scenarios) {
      for (const c of checks(s.id, badOutputs[s.id]).filter((x) => x.basis === 'heuristic')) expect(c.outcome).not.toBe('fail');
    }
    expect(warns('A', badOutputs.A).length).toBeGreaterThan(0); // 秘密の語・恋愛・プレイヤーの決めつけ
    expect(warns('B2', badOutputs.B2).length).toBeGreaterThan(0);
  });

  it('語が見つからなくても「問題なし」とは言わない(言い換えの見逃しを明記する)', () => {
    const c = checks('B1', goodOutputs.B1).find((x) => x.basis === 'heuristic' && x.outcome === 'pass' && !x.label.includes('頼まれていない購入'))!;
    expect(c.detail).toContain('言い換えは検出できない');
  });

  it('よい返答の例は、確定の不合格がない', () => {
    for (const s of scenarios) expect(mechFails(s.id, goodOutputs[s.id]), s.id).toEqual([]);
  });

  it('問題のある返答の例は、すべてのシナリオで不合格か要確認を出す', () => {
    for (const s of scenarios) {
      const o = checks(s.id, badOutputs[s.id]).map((c) => c.outcome);
      expect(o.includes('fail') || o.includes('warn'), s.id).toBe(true);
    }
  });

  it('ゲーム状態で確定できる違反(注文時の支払い・所持金を超える支払い)は「不合格」にする', () => {
    expect(mechFails('E1', badOutputs.E1).map((c) => c.label)).toContain('注文の段階で所持金を減らしていない');
    const over = 'ガロ「毎度」<changes>{"changes":[{"type":"pay","amount":4500}],"promises":[]}</changes>';
    expect(mechFails('E2', over).length).toBeGreaterThan(0);
  });

  it('代金より少ない支払いは、値引きか分割払いか文脈次第なので「要確認」にする', () => {
    expect(mechFails('E2', badOutputs.E2)).toEqual([]);
    expect(warns('E2', badOutputs.E2).map((c) => c.label)).toContain('値引き・臨時収入の疑い(状態変更の提案)');
  });

  it('会話文で値引きを約束したら、状態変更の提案に問題がなくても「要確認」になる', () => {
    const t = 'ガロ「今回は特別にまけてやる。払いはまた今度でいい」<changes>{"changes":[],"promises":[]}</changes>';
    expect(mechFails('E2', t)).toEqual([]);
    expect(warns('E2', t).length).toBeGreaterThan(0);
  });

  it('日本語でない返答・空の返答は「不合格」(機械的に確定)', () => {
    expect(mechFails('A', 'Hello there, nice to meet you.').length).toBeGreaterThan(0);
    expect(checks('A', '')).toEqual([expect.objectContaining({ basis: 'mechanical', outcome: 'fail' })]);
  });
});

describe('頼まれていない購入の検査(2026-10-21の実測で見つかった問題)', () => {
  const unrequested = '袋をそっと押し出す。\nリオ「はい、カモミール一袋、30Gです」<changes>{"changes":[{"type":"purchase","itemName":"カモミールの袋","price":30,"quantity":1}],"promises":[]}</changes>';

  it('取引の場面ではないシナリオで所持金が動く提案があれば、「要確認」にする(不合格にはしない)', () => {
    for (const id of ['A', 'B1', 'B2', 'C', 'D', 'F']) {
      const c = checks(id, unrequested).find((x) => x.label.includes('頼まれていない購入'))!;
      expect(c.basis, id).toBe('heuristic');
      expect(c.outcome, id).toBe('warn');
      expect(c.detail).toContain('重大問題');
      expect(mechFails(id, unrequested).map((x) => x.label), id).not.toContain(c.label);
    }
  });

  it('所持金が動かなければ「該当なし」。取引の場面(E1・E2)には、この検査を付けない', () => {
    expect(checks('B1', goodOutputs.B1).find((x) => x.label.includes('頼まれていない購入'))?.outcome).toBe('pass');
    for (const id of ['E1', 'E2']) expect(sc(id).rules.some((r) => r.kind === 'noUnrequestedMoneyChange'), id).toBe(false);
  });

  it('問題のある模擬の例(B1)は、この検査でも見つかる', () => {
    expect(checks('B1', badOutputs.B1).find((x) => x.label.includes('頼まれていない購入'))?.outcome).toBe('warn');
  });
});

describe('APIキーの扱い', () => {
  it('結果の保存先に、APIキーの置き場所はない', async () => {
    const store = await LabStore.open(new IDBFactory());
    expect(store.storeNames()).toEqual(['results']);
    expect('setKey' in store).toBe(false);
  });

  it('以前の版で保存されたキーは、開いたときに置き場所ごと削除される', async () => {
    const factory = new IDBFactory();
    // 以前の版(DBバージョン1)と同じ形で、キーを保存しておく
    await new Promise<void>((resolve, reject) => {
      const r = factory.open(LAB_DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('results', { keyPath: 'id' });
        r.result.createObjectStore('keys', { keyPath: 'provider' }).put({ provider: 'OpenRouter', key: 'sk-or-OLD-SAVED-KEY-123' });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    const store = await LabStore.open(factory);
    expect(store.legacyKeysRemoved).toBe(true);
    expect(store.storeNames()).not.toContain('keys');
  });

  it('キーは送信先のヘッダーにだけ入り、本文・URL・結果・書き出しには入らない', async () => {
    const key = 'sk-test-SECRET-abcdefghij';
    let seenUrl = '';
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seenUrl = url;
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
      expect(String(init.body)).not.toContain(key);
      return okResponse();
    });
    const r = await runOne(aion, sc('A'), { repeat: 1, keyFor: (id) => (id === 'openrouter' ? key : undefined), verifiedEndpoints: VERIFIED, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.status).toBe('success');
    expect(seenUrl).toBe(ENDPOINTS.openrouter.url);
    expect(seenUrl).not.toContain(key);
    expect(JSON.stringify(r)).not.toContain(key);
    expect(toJson([r], 1)).not.toContain(key);
    expect(toCsv([r])).not.toContain(key);
  });

  it('別の送信先のキーは使わない(Venice のキーを OpenRouter に送らない)', async () => {
    const fetchImpl = vi.fn();
    const r = await callModel(aion, [], {}, { scenarioId: 'A', keyFor: (id) => (id === 'venice' ? 'venice-key-1234567890' : undefined), verifiedEndpoints: VERIFIED, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('エラー文に含まれたキーは伏せ字にする。エラーのときは1回だけで再試行しない', async () => {
    const key = 'sk-test-SECRET-1234567890';
    const fetchImpl = vi.fn(async () => new Response(`invalid key ${key}`, { status: 401 }));
    const r = await callModel(aion, [], {}, { scenarioId: 'A', keyFor: () => key, verifiedEndpoints: VERIFIED, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('error');
    expect(r.error).not.toContain(key);
  });
});

describe('送信先の制限', () => {
  it('許可リストにない送信先・HTTP・オリジン違い・URLに情報を含む送信先は拒否する', () => {
    const base = ENDPOINTS.openrouter;
    expect(validateEndpoint(base)).toBeNull();
    expect(validateEndpoint({ ...base })).not.toBeNull(); // 許可リストの同じ物でなければ拒否
    expect(validateEndpoint(undefined)).not.toBeNull();
    const fake = (p: Partial<Endpoint>) => ({ ...base, ...p });
    expect(validateEndpoint(fake({ url: 'http://openrouter.ai/api/v1/chat/completions' }))).not.toBeNull();
    expect(validateEndpoint(fake({ url: 'https://evil.example/api' }))).not.toBeNull();
  });

  it('ブラウザから直接接続できるか未確認の送信先は、実通信を無効にする(通信もしない)', async () => {
    expect(liveBlockReason(ENDPOINTS.openrouter, new Set())).toContain('確認できていない');
    expect(liveBlockReason(ENDPOINTS.openrouter, VERIFIED)).toBeNull();
    const fetchImpl = vi.fn();
    const r = await callModel(aion, [], {}, { scenarioId: 'A', keyFor: () => 'k'.repeat(20), verifiedEndpoints: new Set(), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('許可リストにない送信先を指定したモデルは送信しない', async () => {
    const rogue: ModelInfo = { ...aion, endpointId: 'somewhere-else' };
    const fetchImpl = vi.fn();
    const r = await callModel(rogue, [], {}, { scenarioId: 'A', keyFor: () => 'k'.repeat(20), verifiedEndpoints: new Set(['somewhere-else']), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('送信時はリダイレクトを追わず、Cookie・参照元を送らない', async () => {
    let init: RequestInit = {};
    const fetchImpl = vi.fn(async (_u: string, i: RequestInit) => {
      init = i;
      return okResponse();
    });
    await callModel(aion, [], {}, { scenarioId: 'A', keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('接続確認は、本物のキーも会話も送らない', async () => {
    let init: RequestInit = {};
    const fetchImpl = vi.fn(async (_u: string, i: RequestInit) => {
      init = i;
      return new Response('unauthorized', { status: 401 });
    });
    const r = await checkBrowserAccess(ENDPOINTS.openrouter, fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(init.body).toBe('{}');
    expect((init.headers as Record<string, string>).Authorization).toContain('not-a-real-key');
    const blocked = await checkBrowserAccess(ENDPOINTS.openrouter, (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    expect(blocked.ok).toBe(false);
  });

  it('APIキーがないとき・接続方法が未確認のモデル(NovelAI)は通信しない', async () => {
    const fetchImpl = vi.fn();
    expect((await callModel(aion, [], {}, { scenarioId: 'A', verifiedEndpoints: VERIFIED, fetchImpl: fetchImpl as unknown as typeof fetch })).error).toContain('入力されていません');
    expect((await callModel(modelByKey('novelai-glm')!, [], {}, { scenarioId: 'A', keyFor: () => 'k'.repeat(20) })).status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('模擬は通信しない。停止すると「停止」として記録される', async () => {
    const fetchImpl = vi.fn();
    expect((await callModel(modelByKey('mock-good')!, [], {}, { scenarioId: 'A', fetchImpl: fetchImpl as unknown as typeof fetch, mockDelayMs: 1 })).status).toBe('success');
    expect(fetchImpl).not.toHaveBeenCalled();
    const ac = new AbortController();
    const p = callModel(modelByKey('mock-good')!, [], {}, { scenarioId: 'A', signal: ac.signal, mockDelayMs: 1000 });
    ac.abort();
    expect((await p).status).toBe('aborted');
  });
});

describe('本文が空だった失敗の記録', () => {
  it('本文が空でも、終了理由と使用量(推論の内訳)を記録し、課金された可能性のある費用も計上する', async () => {
    const body = { choices: [{ message: { content: null, reasoning: '考え中…' }, finish_reason: 'length' }], usage: { prompt_tokens: 1200, completion_tokens: 1000, completion_tokens_details: { reasoning_tokens: 1000 } } };
    const r = await runOne(aion, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch });
    expect(r.status).toBe('error');
    expect(r.error).toContain('本文が空でした');
    expect(r.error).toContain('終了理由: length');
    expect(r.error).toContain('うち推論1000');
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 1000, reasoningTokens: 1000, source: 'api' });
    expect(r.costJpy).toBeCloseTo(((1200 * 0.7 + 1000 * 1.4) / 1e6) * 160);
  });

  it('使用量が返らない空の返答は、費用を0として「使用量は返ってこなかった」と記録する', async () => {
    const r = await runOne(aion, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })) as unknown as typeof fetch });
    expect(r.error).toContain('使用量: 返ってこなかった');
  });
});

describe('生成設定の記録', () => {
  it('非対応の設定は送らず、未確認の設定は注記して送る。指定値と送った値を分けて記録する', async () => {
    const m: ModelInfo = { ...aion, paramOverrides: undefined, params: { temperature: '非対応', max_tokens: '未確認' } };
    const { sent, notes } = buildSentParams(m, { temperature: 0.8, max_tokens: 1000 });
    expect(sent).toEqual({ max_tokens: 1000 });
    expect(notes.join()).toContain('temperature は非対応');
    expect(notes.join()).toContain('max_tokens への対応は未確認');
    const r = await runOne(m, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: (async () => okResponse()) as unknown as typeof fetch });
    expect(r.request.requestedParams).toEqual({ temperature: 0.8, max_tokens: 1000 });
    expect(r.request.sentParams).toEqual({ max_tokens: 1000, stream: false });
  });

  it('Aion は、最初の実通信の結果を受けて max_tokens を 4000 に調整し、その理由を記録する(他のモデルは1000のまま)', () => {
    const a = buildSentParams(aion, { temperature: 0.8, max_tokens: 1000 });
    expect(a.sent.max_tokens).toBe(4000);
    expect(a.notes.join()).toContain('本文が空になった');
    expect(buildSentParams(modelByKey('minimax-m2-her-or')!, { temperature: 0.8, max_tokens: 1000 }).sent.max_tokens).toBe(1000);
  });

  it('モデル固有の調整は、理由とともに記録する', () => {
    const m: ModelInfo = { ...aion, paramOverrides: { values: { max_tokens: 2048 }, reason: '推論の分を含めるため' } };
    const { sent, notes } = buildSentParams(m, { temperature: 0.8, max_tokens: 1000 });
    expect(sent.max_tokens).toBe(2048);
    expect(notes.join()).toContain('推論の分を含めるため');
  });
});

describe('費用', () => {
  const m: ModelInfo = { key: 't', displayName: 't', provider: 'p', adapter: 'none', status: '確認済み', priceInputUsdPerM: 1, priceOutputUsdPerM: 2 };

  it('入力6,000・出力800トークン × 月2,400回を、1ドル160円で円に換算する', () => {
    const c = monthlyCost(m, { calls: 2400, inputTokens: 6000, outputTokens: 800, regenRate: 0, extraRate: 0, rate: 160 });
    expect(c.inputJpy).toBeCloseTo(2304);
    expect(c.outputJpy).toBeCloseTo(614.4);
  });

  it('再生成・追加処理・月額・付与クレジットを分けて計算する', () => {
    const c = monthlyCost({ ...m, monthlyFeeUsd: 10, includedCreditUsd: 5 }, { calls: 2400, inputTokens: 6000, outputTokens: 800, regenRate: 0.1, extraRate: 0.2, rate: 160 });
    expect(c.regenJpy).toBeCloseTo(291.84);
    expect(c.feeJpy).toBe(1600);
    expect(c.creditJpy).toBe(800);
  });

  it('APIが返した実際の使用量を記録し、推論トークンは出力に含めて二重に数えない', async () => {
    const r = await runOne(aion, sc('A'), {
      repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED,
      fetchImpl: (async () => okResponse('リオ「どうも」', { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 300 } })) as unknown as typeof fetch,
    });
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 500, reasoningTokens: 300, source: 'api' });
    expect(r.costJpy).toBeCloseTo(((1000 * 0.7 + 500 * 1.4) / 1e6) * 160); // 500(推論を含む)で計算。800 ではない
    expect(r.price).toMatchObject({ inputUsdPerM: 0.7, outputUsdPerM: 1.4, checkedAt: '2026-10-20' });
  });

  it('使用量が返らないときは概算として記録する', async () => {
    const r = await runOne(aion, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: (async () => okResponse('リオ「どうも」', {})) as unknown as typeof fetch });
    expect(r.usage.source).toBe('estimate');
  });

  it('実測値の平均は、実通信・APIの値・通常の評価の結果だけから出す', async () => {
    const live = await runOne(aion, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: (async () => okResponse('x', { prompt_tokens: 2000, completion_tokens: 600 })) as unknown as typeof fetch });
    const mock = await runOne(modelByKey('mock-good')!, sc('A'), { repeat: 1, mockDelayMs: 1 });
    expect(measuredUsage([live, mock], aion.key)).toEqual({ count: 1, inputTokens: 2000, outputTokens: 600, reasoningTokens: undefined });
    expect(measuredUsage([mock], 'mock-good')).toBeUndefined();
  });

  it('料金が未確認のモデルは「計算できない」と分かる。利用量は 80・100・150・200回/日', () => {
    expect(monthlyCost({ ...modelByKey('glm-5.3-or')!, priceInputUsdPerM: undefined, priceOutputUsdPerM: undefined }, { calls: 3000, inputTokens: 6000, outputTokens: 800, regenRate: 0, extraRate: 0, rate: 160 }).known).toBe(false);
    expect(USAGE_LEVELS.map((u) => u.perDay * 30)).toEqual([2400, 3000, 4500, 6000]);
    expect(estimateTokens('こんにちは')).toBe(5);
  });

  it('料金が分かっている実在のモデルには、確認日と出典がある', () => {
    for (const x of models.filter((y) => y.adapter === 'openai' && y.priceInputUsdPerM !== undefined)) {
      expect(x.priceCheckedAt, x.key).toBeTruthy();
      expect(x.priceSource, x.key).toBeTruthy();
    }
  });
});

describe('処理した提供元の記録', () => {
  it('OpenRouter が返した提供元名を結果とCSVに記録し、返らなければ不明として扱う', async () => {
    const withProvider = new Response(JSON.stringify({ provider: 'Together', choices: [{ message: { content: 'リオ「どうも」' } }], usage: { prompt_tokens: 1000, completion_tokens: 50 } }), { status: 200 });
    const r = await runOne(aion, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: (async () => withProvider) as unknown as typeof fetch });
    expect(r.servedBy).toBe('Together');
    const csv = toCsv([r]).split('\r\n');
    expect(csv[1].split(',')[csv[0].split(',').indexOf('処理した提供元')]).toBe('Together');
    const none = await runOne(aion, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, fetchImpl: (async () => okResponse()) as unknown as typeof fetch });
    expect(none.servedBy).toBeUndefined();
  });
});

describe('料金の更新(2026-10-21)', () => {
  it('DeepSeek と GLM の料金・確認日・出典を持ち、月額の試算ができる', () => {
    const d = modelByKey('deepseek-v4.1-flash-or')!;
    const g = modelByKey('glm-5.3-or')!;
    expect([d.priceInputUsdPerM, d.priceOutputUsdPerM]).toEqual([0.056, 0.12]);
    expect([g.priceInputUsdPerM, g.priceOutputUsdPerM]).toEqual([0.079, 1.4]);
    expect(d.priceCheckedAt).toBe('2026-10-21');
    const c = monthlyCost(d, { calls: 2400, inputTokens: 6000, outputTokens: 1500, regenRate: 0, extraRate: 0, rate: 160 });
    expect(c.known).toBe(true);
    expect(c.totalJpy).toBeLessThan(300);
  });

  it('推論モデルの可能性があるモデルは出力上限を4000に揃え、非推論の MiniMax は1000のまま', () => {
    for (const k of ['aion-3.5-mini-or', 'deepseek-v4.1-flash-or', 'glm-5.3-or']) {
      expect(buildSentParams(modelByKey(k)!, { temperature: 0.8, max_tokens: 1000 }).sent.max_tokens, k).toBe(4000);
    }
    expect(buildSentParams(modelByKey('minimax-m2-her-or')!, { temperature: 0.8, max_tokens: 1000 }).sent.max_tokens).toBe(1000);
  });
});

describe('採点・重大問題・書き出し', () => {
  it('重大問題を点数とは別に保存・書き出しできる', async () => {
    const store = await LabStore.open(new IDBFactory());
    const r: RunResult = await runOne(modelByKey('mock-bad')!, sc('B2'), { repeat: 1, mockDelayMs: 1 });
    r.evaluation = {
      scores: { japanese: 18, persona: 15, relationship: 15, knowledge: 2, freedom: 15, state: 10 },
      reasons: {}, serious: { secretLeak: '「貴族のお嬢様」と断定' }, problemExample: '', comment: '', updatedAt: 1,
    };
    await store.putResult(r);
    const [saved] = await store.listResults();
    expect(totalScore(saved)).toBe(75);
    expect(seriousLabels(saved)).toEqual(['NPCが知り得ない秘密を、確定事実として漏らした(「貴族のお嬢様」と断定)']);
    expect(toCsv([saved])).toContain('確定事実として漏らした');
    expect(toCsv([saved])).toContain('耐性テスト(追加検証)');
    expect(JSON.parse(toJson([saved], 1)).results[0].evaluation.serious.secretLeak).toBe('「貴族のお嬢様」と断定');
  });

  it('CSVは日本語の見出しで、カンマや改行を含む出力も崩れない', async () => {
    const r = await runOne(modelByKey('mock-good')!, sc('A'), { repeat: 1, mockDelayMs: 1 });
    const csv = toCsv([{ ...r, output: 'a,b\n"c"' }]);
    expect(csv).toContain('"a,b\n""c"""');
    expect(csv.split('\r\n')[0]).toContain('日本語の自然さ(20)');
  });

  it('ゲーム本体とは別の保存場所を使う', () => {
    expect(LAB_DB).not.toBe('ai-world-game');
  });
});

describe('簡易評価と記録欄', () => {
  const live = async (model: ModelInfo, env?: { zdr: 'on' | 'off' | 'unknown'; note: string }) =>
    runOne(model, sc('A'), { repeat: 1, keyFor: () => 'k'.repeat(20), verifiedEndpoints: VERIFIED, env, fetchImpl: (async () => okResponse()) as unknown as typeof fetch });

  it('過去の結果(簡易評価なし)は「未評価」のままで、評価済みとして扱われない', async () => {
    const r = await runOne(modelByKey('mock-good')!, sc('A'), { repeat: 1, mockDelayMs: 1 });
    expect(r.quick).toBeUndefined();
    expect(hasSerious(r)).toBe(false);
    const row = toCsv([r]).split('\r\n');
    expect(row[1]).toContain('未評価');
    expect(row[1]).toContain('未記録');
  });

  it('重大問題は総合評価と独立に記録でき、「あり」だけが重大扱いになる(未判断・なしは重大ではない)', async () => {
    const r = await runOne(modelByKey('mock-good')!, sc('A'), { repeat: 1, mockDelayMs: 1 });
    const q = (serious: 'yes' | 'no' | 'unknown') => ({ ...r, quick: { overall: '◎' as const, problems: [], serious, comment: '', updatedAt: 1 } });
    expect(hasSerious(q('yes'))).toBe(true);
    expect(hasSerious(q('no'))).toBe(false);
    expect(hasSerious(q('unknown'))).toBe(false);
    expect(hasSerious({ ...q('no'), evaluation: { scores: {}, reasons: {}, serious: { playerDecided: '' }, problemExample: '', comment: '', updatedAt: 1 } })).toBe(true);
  });

  it('簡易評価が CSV に出る', async () => {
    const r = await runOne(modelByKey('mock-good')!, sc('A'), { repeat: 1, mockDelayMs: 1 });
    const csv = toCsv([{ ...r, quick: { overall: '△', problems: ['playerAct', 'stateChange'], serious: 'yes', comment: '勝手に購入', updatedAt: 1 } }]);
    expect(csv).toContain('△');
    expect(csv).toContain('プレイヤーの意思の代行 / ゲーム状態の不正な変更');
    expect(csv).toContain('あり');
    expect(csv).toContain('勝手に購入');
  });

  it('実際に送った設定が指定値と同じなら「共通条件」、違えば「実運用」と自動で区分される', async () => {
    const plain = await live(modelByKey('mock-good')!);
    const overridden = await live(aion);
    expect(comparisonKind(plain)).toBe('common');
    expect(overridden.request.sentParams.max_tokens).toBe(4000);
    expect(comparisonKind(overridden)).toBe('practical');
  });

  it('ZDR の入力値とメモが結果に記録される(入力しなければ未記録)', async () => {
    const r = await live(aion, { zdr: 'on', note: '盾は緑' });
    expect(r.env).toEqual({ zdr: 'on', note: '盾は緑' });
    const csv = toCsv([r]);
    expect(csv).toContain('オン');
    expect(csv).toContain('盾は緑');
    expect((await live(aion)).env).toBeUndefined();
  });

  it('簡易評価・記録欄つきの結果が、保存して読み直しても残る', async () => {
    const store = await LabStore.open(new IDBFactory());
    const r = await runOne(modelByKey('mock-good')!, sc('A'), { repeat: 1, mockDelayMs: 1, env: { zdr: 'off', note: '' } });
    await store.putResult({ ...r, quick: { overall: '○', problems: ['japanese'], serious: 'no', comment: 'x', updatedAt: 1 } });
    const [back] = await store.listResults();
    expect(back.quick?.overall).toBe('○');
    expect(back.env?.zdr).toBe('off');
  });
});

describe('対照テスト(B1N・B2N)と本文の取引表現の検査', () => {
  it('現行の B1・B2 は変更されず(カモミールの履歴を含む)、対照は別IDで追加されている', () => {
    for (const id of ['B1', 'B2']) expect(JSON.stringify(sc(id).history)).toContain('カモミール');
    expect(sc('B1').track).toBe('standard');
    expect(sc('B2').track).toBe('stress');
    expect(sc('B1N').track).toBe('control');
    expect(sc('B2N').track).toBe('control');
  });

  it('対照は、購入の話題を含まない履歴を使い、質問・場面・判定は B1・B2 と同じ', () => {
    for (const [base, ctl] of [['B1', 'B1N'], ['B2', 'B2N']] as const) {
      const hist = JSON.stringify(sc(ctl).history);
      expect(hist).not.toMatch(/カモミール|購入|買|お代|代金|\d+G|袋|注文|払/);
      expect(sc(ctl).history.length).toBe(sc(base).history.length);
      expect(sc(ctl).playerInput).toBe(sc(base).playerInput);
      expect(sc(ctl).extraContext).toEqual(sc(base).extraContext);
      expect(sc(ctl).state).toEqual(sc(base).state);
      expect(sc(ctl).rules).toEqual(sc(base).rules);
    }
  });

  it('対照は通常の評価・耐性テストの一括実行の対象に入らない', () => {
    expect(scenarios.filter((s) => s.track === 'standard').map((s) => s.id)).not.toContain('B1N');
    expect(scenarios.filter((s) => s.track === 'stress').map((s) => s.id)).toEqual(['B2']);
  });

  it('本文だけが取引を進めている(提案なし)と「要確認」になり、状態との食い違いの疑いが示される', () => {
    const text = 'リオ「それより、カモミールは1袋80Gです。受け取っておきますね」\n<changes>{"changes":[],"promises":[]}</changes>';
    const w = warns('B1', text).filter((c) => c.label.includes('本文で'));
    expect(w).toHaveLength(1);
    expect(w[0].detail).toContain('食い違う疑い');
  });

  it('取引の語がなければ該当なし。よい返答は要確認にならない', () => {
    expect(warns('B1N', goodOutputs.B1N).filter((c) => c.label.includes('本文で'))).toHaveLength(0);
    expect(warns('B2N', goodOutputs.B2N)).toHaveLength(0);
  });

  it('本文と提案の両方に取引があるときも要確認(悪い例)', () => {
    const w = warns('B1N', badOutputs.B1N);
    expect(w.some((c) => c.label.includes('本文で') && c.detail.includes('所持金の変更があります'))).toBe(true);
    expect(w.some((c) => c.label.includes('購入・支払い'))).toBe(true);
  });

  it('模擬の実行で対照も動き、CSV に対照・食い違いの記録が出る', async () => {
    const r = await runOne(modelByKey('mock-good')!, sc('B1N'), { repeat: 1, mockDelayMs: 1 });
    expect(r.track).toBe('control');
    const csv = toCsv([{ ...r, quick: { overall: '△', problems: [], serious: 'yes', mismatch: ['textOnly'], comment: '', updatedAt: 1 } }]);
    expect(csv).toContain('対照テスト');
    expect(csv).toContain('本文だけが、取引・状態の成立を示している');
  });
});
