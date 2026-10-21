import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { modelByKey } from '../../lab/src/models';
import { createInitialSave, initialState } from '../game/initial';
import { serializeBackup } from '../game/save';
import { SaveStore } from '../game/storage';
import type { Message } from '../types';
import { blocksToText, buildGameMessages, MAX_HISTORY_TURNS } from './narrator';
import { describeChange, playTurn, settleChanges } from './turn';
import { DAILY_LIMIT, jstDate, readUsage, tryCount, type KV } from './usage';
import { KeyVault, VAULT_DB, validateApiKey } from './vault';

const KEY = 'sk-or-v1-' + 'a1b2c3d4'.repeat(6);
const model = modelByKey('deepseek-v4.1-flash-or')!;
const okBody = (content: string) =>
  new Response(JSON.stringify({ provider: 'TestProv', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { status: 200 });

describe('APIキーの暗号化保存', () => {
  it('保存して、正しいパスフレーズで復号できる。違うパスフレーズでは復号できない', async () => {
    const v = await KeyVault.open(new IDBFactory());
    expect(await v.hasKey()).toBe(false);
    expect(await v.save(KEY, 'correct horse battery')).toEqual({ ok: true });
    expect(await v.hasKey()).toBe(true);
    expect(await v.unlock('correct horse battery')).toBe(KEY);
    expect(await v.unlock('wrong passphrase!')).toBeNull();
  });

  it('保存されたデータに、平文のキーもパスフレーズも含まれない', async () => {
    const factory = new IDBFactory();
    const v = await KeyVault.open(factory);
    await v.save(KEY, 'correct horse battery');
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = factory.open(VAULT_DB);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = await new Promise<unknown>((res) => {
      const g = db.transaction('vault').objectStore('vault').getAll();
      g.onsuccess = () => res(g.result);
    });
    const dump = JSON.stringify(rec, (_k, val) => (val instanceof Uint8Array ? Array.from(val) : val));
    const asText = new TextDecoder('latin1').decode(((rec as { data: Uint8Array }[])[0]).data);
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain('correct horse');
    expect(asText).not.toContain('sk-or-v1');
  });

  it('同じキー・同じパスフレーズでも、保存するたびに暗号文が変わる(塩と初期値がランダム)', async () => {
    const f1 = new IDBFactory();
    const f2 = new IDBFactory();
    const a = await KeyVault.open(f1);
    const b = await KeyVault.open(f2);
    await a.save(KEY, 'correct horse battery');
    await b.save(KEY, 'correct horse battery');
    const get = (f: IDBFactory) =>
      new Promise<number[]>((res) => {
        const r = f.open(VAULT_DB);
        r.onsuccess = () => {
          const g = r.result.transaction('vault').objectStore('vault').get('openrouter-key');
          g.onsuccess = () => res(Array.from(g.result.data as Uint8Array));
        };
      });
    expect(await get(f1)).not.toEqual(await get(f2));
  });

  it('削除できる。短いパスフレーズ・空白入りのキーは拒否する', async () => {
    const v = await KeyVault.open(new IDBFactory());
    expect((await v.save(KEY, 'short')).ok).toBe(false);
    expect((await v.save('sk or v1 with spaces 12345678901', 'correct horse battery')).ok).toBe(false);
    expect(validateApiKey('')).not.toBeNull();
    await v.save(KEY, 'correct horse battery');
    await v.remove();
    expect(await v.hasKey()).toBe(false);
    expect(await v.unlock('correct horse battery')).toBeNull();
  });

  it('セーブ用のデータベースとは別で、バックアップにもキーは入らない', async () => {
    const factory = new IDBFactory();
    const v = await KeyVault.open(factory);
    await v.save(KEY, 'correct horse battery');
    const store = await SaveStore.open(factory);
    const s = createInitialSave('a', 1);
    await store.put(s);
    expect(VAULT_DB).not.toBe('ai-world-game');
    expect(serializeBackup(s, 1)).not.toContain(KEY);
    expect(JSON.stringify(await store.listSaves())).not.toContain(KEY);
  });
});

describe('1日の呼び出し回数の上限', () => {
  const mem = (): KV & { v: string | null } => {
    const o = { v: null as string | null, get: () => o.v, set: (x: string) => void (o.v = x) };
    return o;
  };
  const t0 = Date.UTC(2026, 9, 21, 3, 0, 0);

  it('上限まで数え、超えたら止まる(数え過ぎない)', () => {
    const kv = mem();
    for (let i = 1; i <= 3; i++) expect(tryCount(kv, t0, 3)).toMatchObject({ ok: true, count: i });
    expect(tryCount(kv, t0, 3)).toMatchObject({ ok: false, count: 3 });
    expect(readUsage(kv, t0).count).toBe(3);
  });

  it('日本時間で日付が変わるとリセットされる', () => {
    const kv = mem();
    tryCount(kv, Date.UTC(2026, 9, 21, 14, 59), 1); // 日本時間 23:59
    expect(tryCount(kv, Date.UTC(2026, 9, 21, 14, 59), 1).ok).toBe(false);
    expect(tryCount(kv, Date.UTC(2026, 9, 21, 15, 1), 1).ok).toBe(true); // 日本時間 翌 0:01
    expect(jstDate(Date.UTC(2026, 9, 21, 15, 0))).toBe('2026-10-22');
  });

  it('壊れた記録は 0 から数え直す。既定の上限は200', () => {
    const kv = mem();
    kv.set('{broken');
    expect(readUsage(kv, t0).count).toBe(0);
    expect(DAILY_LIMIT).toBe(200);
  });
});

describe('モデルに渡す内容', () => {
  const save = createInitialSave('a', 1);
  const turns = (n: number): Message[] => {
    const ms: Message[] = [...save.messages];
    for (let i = 0; i < n; i++) {
      ms.push({ id: ms.length, role: 'player', text: `発言${i}` });
      ms.push({ id: ms.length, role: 'ai', blocks: [{ type: 'speech', speaker: 'リオ', text: `返答${i}` }], state: save.messages[0].role === 'ai' ? save.messages[0].state : (undefined as never) });
    }
    return ms;
  };

  it('導入はシステムの説明に入れ、履歴は発言から始め、最後に今の入力を付ける', () => {
    const m = buildGameMessages(initialState(), turns(2), '今の入力');
    expect(m[0].role).toBe('system');
    expect(m[0].content).toContain('物語の導入');
    expect(m[1]).toEqual({ role: 'user', content: '発言0' });
    expect(m[2]).toEqual({ role: 'assistant', content: 'リオ「返答0」' });
    expect(m[m.length - 1]).toEqual({ role: 'user', content: '今の入力' });
  });

  it('送る履歴は直近の決まった回数だけ(費用の増加を抑える)', () => {
    const m = buildGameMessages(initialState(), turns(MAX_HISTORY_TURNS + 20), 'x');
    expect(m.length).toBe(1 + MAX_HISTORY_TURNS * 2 + 1);
    expect(m[1]).toEqual({ role: 'user', content: '発言20' });
  });

  it('NPCの秘密は渡さない。現在の状態(所持金・場所)は渡す', () => {
    const sys = buildGameMessages(initialState(), turns(1), 'x')[0].content;
    expect(sys).not.toContain('宮廷薬師');
    expect(sys).not.toContain('家出してきた貴族');
    expect(sys).toContain('リオ');
    expect(sys).toContain('所持金: 3000G');
    expect(sys).toContain('港町ルセナ・工房通り');
  });

  it('AIの返答を、セリフは「名前「…」」の形で履歴に戻す', () => {
    expect(blocksToText([{ type: 'narration', text: '朝だ' }, { type: 'speech', speaker: 'ガロ', text: 'おう' }])).toBe('朝だ\nガロ「おう」');
  });
});

describe('1ターンの処理', () => {
  const state = initialState();
  const run = (fetchImpl: typeof fetch, extra: object = {}) =>
    playTurn({ model, apiKey: KEY, state, messages: createInitialSave('a', 1).messages, playerText: 'こんにちは', fetchImpl, ...extra });

  it('返答を読み取り、状態変更の提案を返す。キーは Authorization だけに入れる', async () => {
    let body = '';
    let auth = '';
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      body = String(init?.body);
      auth = String((init?.headers as Record<string, string>).Authorization);
      return okBody('リオ「いらっしゃい」\n<changes>{"changes":[{"type":"pay","amount":100,"reason":"お茶"}],"promises":[]}</changes>');
    });
    const r = await run(f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, servedBy: 'TestProv' });
    if (r.ok) {
      expect(r.blocks[0]).toEqual({ type: 'speech', speaker: 'リオ', text: 'いらっしゃい' });
      expect(r.changes).toEqual([{ type: 'pay', amount: 100, reason: 'お茶' }]);
    }
    expect(auth).toBe(`Bearer ${KEY}`);
    expect(body).not.toContain(KEY);
    expect(JSON.parse(body).stream).toBe(false);
  });

  it('提案が無いときは変更なし。形式が壊れているときだけ知らせる', async () => {
    const none = await run((async () => okBody('リオ「どうも」')) as unknown as typeof fetch);
    expect(none).toMatchObject({ ok: true, changes: [] });
    expect(none.ok && none.notice).toBeUndefined();
    const broken = await run((async () => okBody('リオ「どうも」\n<changes>{ここが壊れている</changes>')) as unknown as typeof fetch);
    expect(broken.ok && broken.notice).toContain('読み取れなかった');
  });

  it('通信の失敗・停止は失敗として返す(会話や状態は呼び出し側が変えない)', async () => {
    const fail = await run((async () => new Response('server error', { status: 500 })) as unknown as typeof fetch);
    expect(fail).toMatchObject({ ok: false, aborted: false });
    const ac = new AbortController();
    const p = run((async (_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))))) as unknown as typeof fetch, { signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, aborted: true });
  });

  it('キーが無いモデル接続は送信しない', async () => {
    const f = vi.fn();
    const r = await playTurn({ model, apiKey: '', state, messages: [], playerText: 'x', fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('変更案は、その時点の状態に対して検証して反映する。成立しないときは状態を変えない', () => {
    const ok = settleChanges(state, [{ type: 'purchase', itemName: 'カモミール', price: 50 }]);
    expect(ok.state.money).toBe(2950);
    expect(ok.applied?.labels).toEqual(['「カモミール」を50で購入']);
    expect(ok.applied?.before).toBe(state);
    const ng = settleChanges(state, [{ type: 'pay', amount: 999999 }]);
    expect(ng.state).toBe(state);
    expect(ng.applied).toBeNull();
    expect(ng.notice).toContain('反映されませんでした');
    expect(settleChanges(state, [])).toEqual({ state, applied: null });
  });

  it('変更の説明が人に読める文になる', () => {
    expect(describeChange({ type: 'setPlace', place: '灯台' })).toBe('場所を「灯台」に移動');
    expect(describeChange({ type: 'addItem', name: '小瓶', quantity: 2 })).toBe('「小瓶×2」を入手');
  });
});

describe('成人向けモードと提供元の指定', () => {
  const sysOf = (adult: boolean) => buildGameMessages(initialState(), createInitialSave('a', 1).messages, 'x', undefined, { adult })[0].content;

  it('既定(オフ)では、成人向けの指示は入らない', () => {
    expect(sysOf(false)).not.toContain('成人向けモード');
    expect(sysOf(false)).not.toContain('21歳未満');
  });

  it('オンにすると、成人どうし・合意・21歳以上だけ、という決まりが入り、21歳未満の人物(ミラ19歳)に注意書きが付く', () => {
    const s = sysOf(true);
    expect(s).toContain('成人向けモード(有効)');
    expect(s).toContain('合意に基づく');
    expect(s).toContain('21歳以上と設定された人物だけ');
    expect(s).toContain('年齢が不明・曖昧な人物は、どんな場合も、性的な場面に関わらせない');
    const mira = s.slice(s.indexOf('## ミラ'), s.indexOf('## ガロ'));
    expect(mira).toContain('21歳未満: 性的な場面には、どんな場合も関わらせない');
    const rio = s.slice(s.indexOf('## リオ'), s.indexOf('## ミラ'));
    expect(rio).not.toContain('21歳未満');
  });

  it('オンでも、プレイヤーの行動・感情を勝手に書かない決まり(v2の2番)と、NPCの秘密を渡さない扱いは変わらない', () => {
    const s = sysOf(true);
    expect(s).toContain('プレイヤー(カイ)の行動・発言・感情・決定を書かない');
    expect(s).not.toContain('宮廷薬師');
  });

  it('提供元を指定したときだけ、その提供元に限定・他へ切り替えない・ZDRの提供元だけ、で送る', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return okBody('リオ「どうも」');
    }) as unknown as typeof fetch;
    const base = { model, apiKey: KEY, state: initialState(), messages: createInitialSave('a', 1).messages, playerText: 'x', fetchImpl: f };
    await playTurn(base);
    await playTurn({ ...base, providerPin: '  example/fp8 ' });
    expect('provider' in bodies[0]).toBe(false);
    expect(bodies[1].provider).toEqual({ order: ['example/fp8'], only: ['example/fp8'], allow_fallbacks: false, zdr: true });
    expect(JSON.stringify(bodies[1])).not.toContain(KEY);
  });

  it('形式が正しくない提供元の識別名では、送信せずに失敗にする', async () => {
    const calls = vi.fn();
    const r = await playTurn({ model, apiKey: KEY, state: initialState(), messages: [], playerText: 'x', providerPin: 'a b;c', fetchImpl: calls as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(calls).not.toHaveBeenCalled();
  });
});
