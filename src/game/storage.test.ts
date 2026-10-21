import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createInitialSave } from './initial';
import { applyChange } from './state';
import { SaveStore } from './storage';

const MIN = 60 * 1000;
let clock = 0;
const open = () => SaveStore.open(new IDBFactory(), () => clock);

describe('端末内保存', () => {
  it('保存して読み出すと、同じ内容が返る', async () => {
    const store = await open();
    const s = createInitialSave('a', 1);
    await store.put(s);
    const r = await store.load('a');
    expect(r.kind === 'ok' && r.save).toEqual(s);
  });

  it('保存されていないセーブは missing になる', async () => {
    const store = await open();
    expect((await store.load('none')).kind).toBe('missing');
  });

  it('使っているセーブの記録と、下書きを別枠で保存・復元できる', async () => {
    const store = await open();
    await store.setActiveId('a');
    expect(await store.getActiveId()).toBe('a');
    await store.putDraft('a', '*扉を開ける*');
    expect(await store.getDraft('a')).toBe('*扉を開ける*');
    await store.putDraft('a', '');
    expect(await store.getDraft('a')).toBe('');
  });

  it('復旧用の控えは、一定間隔ごとに取り、直近3世代だけ残す', async () => {
    const store = await open();
    clock = 0;
    let s = createInitialSave('a', 0);
    await store.put(s); // 初回は控えなし
    for (let i = 1; i <= 6; i++) {
      clock += 11 * MIN;
      const r = applyChange(s.state, { type: 'receive', amount: 10 });
      if (!r.ok) throw new Error('失敗');
      s = { ...s, state: r.state, updatedAt: clock };
      await store.put(s);
    }
    expect(await store.countSnapshots('a')).toBe(3);
  });

  it('間隔が短い保存では、控えを増やさない', async () => {
    const store = await open();
    clock = 0;
    const s = createInitialSave('a', 0);
    await store.put(s);
    await store.put({ ...s, updatedAt: 1 });
    await store.put({ ...s, updatedAt: 2 });
    await store.put({ ...s, updatedAt: 3 });
    expect(await store.countSnapshots('a')).toBe(1);
  });

  it('壊れたセーブは、退避して残したうえで、直近の正常な控えから復元する', async () => {
    const factory = new IDBFactory();
    clock = 0;
    const store = await SaveStore.open(factory, () => clock);
    const s = createInitialSave('a', 0);
    await store.put(s);
    clock += 11 * MIN;
    await store.put({ ...s, name: '新しい名前', updatedAt: clock }); // 控えに s が入る
    // 現在のセーブを壊す(外部から直接書き換え)
    await new Promise<void>((resolve, reject) => {
      const tx = (store as unknown as { db: IDBDatabase }).db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put({ id: 'a', broken: true });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const r = await store.load('a');
    expect(r.kind).toBe('recovered');
    if (r.kind === 'recovered') expect(r.save.name).toBe(s.name);
    expect(await store.countQuarantined()).toBe(1);
    expect((await store.load('a')).kind).toBe('ok'); // 復元後は正常に読める
  });

  it('控えもない壊れたセーブは、lost として知らせ、原本は退避して残す', async () => {
    const store = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = (store as unknown as { db: IDBDatabase }).db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put({ id: 'x', broken: true });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    expect((await store.load('x')).kind).toBe('lost');
    expect(await store.countQuarantined()).toBe(1);
    expect(await store.listSaves()).toEqual([]); // 壊れた原本は一覧に残らない
  });

  it('セーブ一覧は、新しく更新した順に返る', async () => {
    const store = await open();
    await store.put(createInitialSave('old', 1, '古い'));
    await store.put(createInitialSave('new', 2, '新しい'));
    expect((await store.listSaves()).map((x) => x.id)).toEqual(['new', 'old']);
  });

  it('セーブを消すと、そのセーブの下書き・復旧用の控えも消え、ほかのセーブは残る', async () => {
    const store = await open();
    const a = createInitialSave('a', 1, 'A');
    const b = createInitialSave('b', 2, 'B');
    await store.put(a);
    await store.put(b);
    await store.putDraft('a', '書きかけ');
    await store.put({ ...a, updatedAt: 99 }); // 控えができる
    expect(await store.countSnapshots('a')).toBeGreaterThan(0);
    await store.deleteSave('a');
    expect((await store.listSaves()).map((x) => x.id)).toEqual(['b']);
    expect((await store.load('a')).kind).toBe('missing');
    expect(await store.getDraft('a')).toBe('');
    expect(await store.countSnapshots('a')).toBe(0);
    expect((await store.load('b')).kind).toBe('ok');
  });

  it('存在しないセーブを消そうとしても、エラーにならない', async () => {
    const store = await open();
    await store.deleteSave('none');
    expect(await store.listSaves()).toEqual([]);
  });
});
