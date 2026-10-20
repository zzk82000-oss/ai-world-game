import { describe, expect, it } from 'vitest';
import { createInitialSave } from './initial';
import { importAsNew, parseBackup, serializeBackup, validateSave } from './save';

const save = () => createInitialSave('id-1', 1000, 'テスト');

describe('セーブデータの検証', () => {
  it('正しいデータは通る', () => {
    expect(validateSave(save()).ok).toBe(true);
  });

  it('JSONに変換して戻しても、同じデータになる', () => {
    const s = save();
    const back = validateSave(JSON.parse(JSON.stringify(s)));
    expect(back.ok && back.save).toEqual(s);
  });

  it('壊れたデータは拒否する', () => {
    const bad: unknown[] = [
      null,
      'text',
      {},
      { ...save(), state: { ...save().state, money: -1 } },
      { ...save(), state: { ...save().state, money: 1.5 } },
      { ...save(), state: { ...save().state, items: [{ name: '薬', quantity: 0 }] } },
      { ...save(), state: { ...save().state, facilities: [{ name: '金庫', status: 'broken' }] } },
      { ...save(), messages: [{ id: 1, role: 'player' }] },
      { ...save(), messages: 'x' },
    ];
    for (const b of bad) expect(validateSave(b).ok).toBe(false);
  });

  it('新しい形式のデータは、安全のため読み込まない', () => {
    const r = validateSave({ ...save(), format: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('新しい形式');
  });
});

describe('バックアップ', () => {
  it('書き出して読み込むと、同じ内容に戻る', () => {
    const s = save();
    const r = parseBackup(serializeBackup(s, 5000));
    expect(r.ok && r.save).toEqual(s);
  });

  it('このアプリのバックアップでないファイルは拒否する', () => {
    expect(parseBackup('{"a":1}').ok).toBe(false);
    expect(parseBackup('これはJSONではない').ok).toBe(false);
  });

  it('読み込みは別のセーブとして取り込み、既存のIDと名前を変えない', () => {
    const s = save();
    const imported = importAsNew(s, ['テスト(取り込み)'], 9000);
    expect(imported.id).not.toBe(s.id);
    expect(imported.name).toBe('テスト(取り込み)2');
    expect(imported.state).toEqual(s.state);
  });

  it('APIキーや個人情報を含む項目をバックアップに入れない', () => {
    const text = serializeBackup(save(), 1);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['app', 'exportedAt', 'format', 'kind', 'save']);
  });
});
