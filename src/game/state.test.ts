import { describe, expect, it } from 'vitest';
import { applyChange, applyChanges, createState, type GameState } from './state';

const ok = (r: ReturnType<typeof applyChange>): GameState => {
  if (!r.ok) throw new Error(`失敗するはずがない: ${r.error}`);
  return r.state;
};

describe('仕様書の受け入れテスト', () => {
  it('9,475Gから4,500Gを支払うと、4,975Gになる', () => {
    const s = createState({ money: 9475 });
    expect(ok(applyChange(s, { type: 'pay', amount: 4500 })).money).toBe(4975);
  });

  it('発注のみでは支払いが発生せず、支払った時点で残高が変わる', () => {
    const s0 = createState({ money: 9475 });
    const s1 = ok(applyChange(s0, { type: 'orderFacility', name: '金庫' }));
    expect(s1.money).toBe(9475);
    expect(s1.facilities).toEqual([{ name: '金庫', status: 'ordered' }]);
    const s2 = ok(applyChange(s1, { type: 'pay', amount: 4500, reason: '金庫の代金' }));
    expect(s2.money).toBe(4975);
  });

  it('金庫は設備、鍵は所持品として別々に記録できる', () => {
    let s = createState({ money: 9475 });
    s = ok(applyChange(s, { type: 'orderFacility', name: '金庫' }));
    s = ok(applyChange(s, { type: 'setFacilityStatus', name: '金庫', status: 'installed' }));
    s = ok(applyChange(s, { type: 'addItem', name: '金庫の鍵', quantity: 2 }));
    expect(s.facilities).toEqual([{ name: '金庫', status: 'installed' }]);
    expect(s.items).toEqual([{ name: '金庫の鍵', quantity: 2 }]);
  });

  it('所持品を2個入手し、1個使用したら1個残る', () => {
    let s = createState();
    s = ok(applyChange(s, { type: 'addItem', name: '回復薬', quantity: 2 }));
    s = ok(applyChange(s, { type: 'consumeItem', name: '回復薬' }));
    expect(s.items).toEqual([{ name: '回復薬', quantity: 1 }]);
  });

  it('手動で所持金を増額したら、次のターンで新残高を前提に支払える', () => {
    const s0 = createState({ money: 1475 });
    // 増額前は足りない
    expect(applyChange(s0, { type: 'pay', amount: 4500 }).ok).toBe(false);
    const s1 = ok(applyChange(s0, { type: 'setMoney', amount: 9475 }));
    const s2 = ok(applyChange(s1, { type: 'pay', amount: 4500 }));
    expect(s2.money).toBe(4975);
  });
});

describe('成立しない操作は、状態を変えずに理由を返す', () => {
  it('所持金が足りない支払いは成立しない', () => {
    const s = createState({ money: 100 });
    const r = applyChange(s, { type: 'pay', amount: 101 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('所持金が足りません');
  });

  it('金額が整数でない・0以下・数値でない場合は成立しない', () => {
    const s = createState({ money: 1000 });
    for (const amount of [0, -5, 1.5, NaN, Infinity]) {
      expect(applyChange(s, { type: 'pay', amount }).ok).toBe(false);
      expect(applyChange(s, { type: 'receive', amount }).ok).toBe(false);
    }
  });

  it('持っていない物は使えない・数量が足りない物は使えない', () => {
    const s = createState({ items: [{ name: '薬', quantity: 1 }] });
    expect(applyChange(s, { type: 'consumeItem', name: '剣' }).ok).toBe(false);
    expect(applyChange(s, { type: 'consumeItem', name: '薬', quantity: 2 }).ok).toBe(false);
  });

  it('数量が0になった物は一覧から消え、マイナスにはならない', () => {
    let s = createState({ items: [{ name: '薬', quantity: 1 }] });
    s = ok(applyChange(s, { type: 'consumeItem', name: '薬' }));
    expect(s.items).toEqual([]);
  });

  it('同じ設備を二重に発注することはできない', () => {
    const s = ok(applyChange(createState(), { type: 'orderFacility', name: '金庫' }));
    expect(applyChange(s, { type: 'orderFacility', name: '金庫' }).ok).toBe(false);
  });
});

describe('購入・売却・一括適用', () => {
  it('購入は支払いと入手を一体で確定する', () => {
    const s = ok(
      applyChange(createState({ money: 500 }), { type: 'purchase', itemName: '水', price: 100, quantity: 2 }),
    );
    expect(s.money).toBe(400);
    expect(s.items).toEqual([{ name: '水', quantity: 2 }]);
  });

  it('お金が足りない購入は、物も増えず、お金も減らない', () => {
    const s0 = createState({ money: 50 });
    const r = applyChange(s0, { type: 'purchase', itemName: '水', price: 100 });
    expect(r.ok).toBe(false);
    expect(s0.money).toBe(50);
    expect(s0.items).toEqual([]);
  });

  it('売却は物を手放して代金を受け取る', () => {
    const s0 = createState({ money: 0, items: [{ name: '牙', quantity: 2 }] });
    const s1 = ok(applyChange(s0, { type: 'sell', itemName: '牙', price: 300 }));
    expect(s1.money).toBe(300);
    expect(s1.items).toEqual([{ name: '牙', quantity: 1 }]);
  });

  it('持っていない物は売れない', () => {
    expect(applyChange(createState(), { type: 'sell', itemName: '牙', price: 300 }).ok).toBe(false);
  });

  it('一括適用は全部成立するか、全部反映されないかのどちらか', () => {
    const s0 = createState({ money: 1000 });
    const r = applyChanges(s0, [
      { type: 'pay', amount: 400 },
      { type: 'addItem', name: '地図' },
      { type: 'consumeItem', name: '存在しない物' }, // ここで失敗
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failedIndex).toBe(2);
    expect(s0.money).toBe(1000); // 元の状態はそのまま
    expect(s0.items).toEqual([]);
  });

  it('一括適用は順番どおりに計算する(受け取ってから支払える)', () => {
    const r = applyChanges(createState({ money: 0 }), [
      { type: 'receive', amount: 300, reason: '報酬' },
      { type: 'pay', amount: 200 },
    ]);
    expect(ok(r).money).toBe(100);
  });
});

describe('所持品の扱い', () => {
  it('数量を管理しない物は、重ねて入手しても1つのまま', () => {
    let s = createState();
    s = ok(applyChange(s, { type: 'addItem', name: 'スマホ' }));
    s = ok(applyChange(s, { type: 'addItem', name: 'スマホ' }));
    expect(s.items).toEqual([{ name: 'スマホ' }]);
  });

  it('新しい物は末尾に入る(入手順)', () => {
    let s = createState();
    for (const name of ['A', 'B', 'C']) s = ok(applyChange(s, { type: 'addItem', name }));
    expect(s.items.map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });

  it('手放した物は一覧から消える。持っていない物は手放せない', () => {
    const s = createState({ items: [{ name: '古い本' }] });
    expect(ok(applyChange(s, { type: 'discardItem', name: '古い本' })).items).toEqual([]);
    expect(applyChange(s, { type: 'discardItem', name: '新しい本' }).ok).toBe(false);
  });

  it('手動で数量を直せる(0にすると消える)', () => {
    const s = createState({ items: [{ name: '薬', quantity: 5 }] });
    expect(ok(applyChange(s, { type: 'setItemQuantity', name: '薬', quantity: 3 })).items).toEqual([
      { name: '薬', quantity: 3 },
    ]);
    expect(ok(applyChange(s, { type: 'setItemQuantity', name: '薬', quantity: 0 })).items).toEqual([]);
  });
});

describe('履歴と元のデータの保護', () => {
  it('所持金の変更は履歴に残る', () => {
    let s = createState({ money: 1000 });
    s = ok(applyChange(s, { type: 'pay', amount: 300, reason: '水を購入' }));
    s = ok(applyChange(s, { type: 'receive', amount: 50, reason: '報酬' }));
    expect(s.ledger).toEqual([
      { kind: 'pay', amount: 300, before: 1000, after: 700, reason: '水を購入' },
      { kind: 'receive', amount: 50, before: 700, after: 750, reason: '報酬' },
    ]);
  });

  it('更新しても、元の状態のオブジェクトは書き換わらない', () => {
    const s0 = createState({ money: 1000, items: [{ name: '薬', quantity: 2 }] });
    const snapshot = JSON.stringify(s0);
    applyChange(s0, { type: 'pay', amount: 100 });
    applyChange(s0, { type: 'consumeItem', name: '薬' });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});
