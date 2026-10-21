// セーブデータの形式・検証・バックアップ。画面にも保存先にも依存しない(テストしやすい)。
import type { Message } from '../types';
import type { Npc } from '../../lab/src/types';
import { validateCharacters, validatePlayer, type Player } from './cast';
import type { GameState } from './state';

export const SAVE_FORMAT = 1;

export type SaveData = {
  format: number; // データ形式のバージョン。形式を変えるときは上げて、migrate を書く
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  state: GameState;
  messages: Message[];
  characters?: Npc[]; // このセーブの登場人物(なければ既定)
  player?: Player; // このセーブの主人公(なければ既定)
  setup?: string; // プレイヤーが決めた設定メモ(関係・状況など)。AIに「最優先で守る設定」として渡す
};

export const SETUP_MAX = 4000;

// バックアップファイル。ゲームの文字データだけを含む(APIキーなどは入れない)
export type Backup = {
  app: 'ai-world-game';
  kind: 'backup';
  format: number;
  exportedAt: number;
  save: SaveData;
};

export type Validated = { ok: true; save: SaveData } | { ok: false; error: string };

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isInt = (x: unknown): x is number => Number.isSafeInteger(x);

function badItem(x: unknown): boolean {
  return !isObj(x) || !isStr(x.name) || !x.name || (x.quantity !== undefined && !(isInt(x.quantity) && x.quantity > 0));
}

function checkStatus(x: unknown, withLedger: boolean): string | null {
  if (!isObj(x)) return '状態が正しくありません';
  if (!isStr(x.currency) || !isStr(x.place) || !isStr(x.datetime)) return '状態の文字項目が正しくありません';
  if (!isInt(x.money) || x.money < 0) return '所持金が正しくありません';
  if (!Array.isArray(x.items) || x.items.some(badItem)) return '所持品が正しくありません';
  if (
    !Array.isArray(x.facilities) ||
    x.facilities.some((f) => !isObj(f) || !isStr(f.name) || !['ordered', 'delivered', 'installed'].includes(f.status as string))
  ) {
    return '設備が正しくありません';
  }
  if (withLedger) {
    if (
      !Array.isArray(x.ledger) ||
      x.ledger.some(
        (e) =>
          !isObj(e) ||
          !['pay', 'receive', 'edit'].includes(e.kind as string) ||
          !isInt(e.amount) ||
          !isInt(e.before) ||
          !isInt(e.after) ||
          (e.reason !== undefined && !isStr(e.reason)),
      )
    ) {
      return '所持金の履歴が正しくありません';
    }
  }
  return null;
}

function checkMessage(m: unknown): string | null {
  if (!isObj(m) || !isInt(m.id)) return '会話の記録が正しくありません';
  if (m.role === 'player') return isStr(m.text) ? null : '会話の記録が正しくありません';
  if (m.role !== 'ai') return '会話の記録が正しくありません';
  if (
    !Array.isArray(m.blocks) ||
    m.blocks.some(
      (b) => !isObj(b) || !isStr(b.text) || !(b.type === 'narration' || (b.type === 'speech' && isStr(b.speaker))),
    )
  ) {
    return '会話の記録が正しくありません';
  }
  if (m.notice !== undefined && !isStr(m.notice)) return '会話の記録が正しくありません';
  return checkStatus(m.state, false);
}

// 形式の古いデータは、ここで安全に変換できるときだけ新しい形式にする(いまは format 1 のみ)
function migrate(raw: Obj): Obj | string {
  if (!isInt(raw.format)) return 'データの形式が分かりません';
  if (raw.format > SAVE_FORMAT) return 'このアプリより新しい形式のデータです。アプリを更新してから読み込んでください';
  if (raw.format < 1) return '古すぎる形式のデータです';
  return raw;
}

export function validateSave(x: unknown): Validated {
  if (!isObj(x)) return { ok: false, error: 'セーブデータが正しくありません' };
  const migrated = migrate(x);
  if (typeof migrated === 'string') return { ok: false, error: migrated };
  const s = migrated;
  if (!isStr(s.id) || !s.id || !isStr(s.name) || !isInt(s.createdAt) || !isInt(s.updatedAt)) {
    return { ok: false, error: 'セーブデータの基本情報が正しくありません' };
  }
  const stateError = checkStatus(s.state, true);
  if (stateError) return { ok: false, error: stateError };
  if (s.setup !== undefined && !(isStr(s.setup) && s.setup.length <= SETUP_MAX)) return { ok: false, error: '設定メモが正しくありません' };
  if (s.characters !== undefined) {
    const e = validateCharacters(s.characters);
    if (e) return { ok: false, error: e };
  }
  if (s.player !== undefined) {
    const e = validatePlayer(s.player);
    if (e) return { ok: false, error: e };
  }
  if (!Array.isArray(s.messages)) return { ok: false, error: '会話の記録が正しくありません' };
  for (const m of s.messages) {
    const e = checkMessage(m);
    if (e) return { ok: false, error: e };
  }
  return { ok: true, save: s as unknown as SaveData };
}

export function serializeBackup(save: SaveData, now: number): string {
  const backup: Backup = { app: 'ai-world-game', kind: 'backup', format: SAVE_FORMAT, exportedAt: now, save };
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(text: string): Validated {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'ファイルを読み取れません(JSONではありません)' };
  }
  if (!isObj(raw) || raw.app !== 'ai-world-game' || raw.kind !== 'backup') {
    return { ok: false, error: 'このアプリのバックアップファイルではありません' };
  }
  if (isInt(raw.format) && raw.format > SAVE_FORMAT) {
    return { ok: false, error: 'このアプリより新しい形式のバックアップです。アプリを更新してから読み込んでください' };
  }
  return validateSave(raw.save);
}

// 読み込んだバックアップは、既存のセーブを上書きせず、別のセーブとして取り込む
export function importAsNew(imported: SaveData, existingNames: string[], now: number): SaveData {
  const base = `${imported.name}(取り込み)`;
  let name = base;
  for (let n = 2; existingNames.includes(name); n++) name = `${base}${n}`;
  return { ...imported, id: newId(), name, createdAt: now, updatedAt: now };
}
