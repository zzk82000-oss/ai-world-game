// セーブごとの、登場人物と主人公の設定。未編集のセーブは、既定(lab の fixture と共通)を使う。
// 人物の「秘密」は、AIには渡さない(1つのAIが全員を演じるため)ので、ここでは編集しない。
import { npcs as DEFAULT_NPCS, player as DEFAULT_PLAYER } from '../../lab/src/data/fixture';
import type { Npc } from '../../lab/src/types';

export type Player = { name: string; profile: string };

export const MAX_CHARACTERS = 20;
export const NAME_RE = /^[^\s「」*]{1,16}$/; // セリフの話者として読み取れる名前(空白・かぎ括弧・* を含まない)
const LIMIT = { short: 100, long: 600, list: 20, item: 60 };

export const defaultCharacters = (): Npc[] => Object.values(DEFAULT_NPCS).map((n) => ({ ...n, likes: [...n.likes], dislikes: [...n.dislikes], values: [...n.values] }));
export const defaultPlayer = (): Player => ({ ...DEFAULT_PLAYER });

export const emptyCharacter = (): Npc => ({ name: '', age: 25, role: '', personality: '', speech: '', likes: [], dislikes: [], values: [], routine: '' });

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const isList = (x: unknown): x is string[] => Array.isArray(x) && x.length <= LIMIT.list && x.every((s) => isStr(s, LIMIT.item));

// 性的な場面の対象にできるのは、21歳以上と、数字で設定された人物だけ(未入力・不明は対象外)
export const ADULT_AGE = 21;
export const isAdultTarget = (age: unknown): boolean => Number.isInteger(age) && (age as number) >= ADULT_AGE;

// 表示用の画像。端末で縮小した data URL だけを受け付ける(AIには送らない)
export const IMAGE_MAX_CHARS = 400_000;
export const isImageData = (x: unknown): x is string => typeof x === 'string' && x.length <= IMAGE_MAX_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x);

export function validateCharacter(n: unknown): string | null {
  if (!isObj(n)) return '人物の設定が正しくありません';
  if (typeof n.name !== 'string' || !NAME_RE.test(n.name)) return '名前は、1〜16文字で、空白・「」・* を含めないでください';
  if (!Number.isInteger(n.age) || (n.age as number) < 1 || (n.age as number) > 999) return `${n.name}: 年齢は、1〜999の整数で入力してください`;
  if (!isStr(n.role, LIMIT.short)) return `${n.name}: 役割が長すぎます`;
  if (!isStr(n.personality, LIMIT.long) || !isStr(n.speech, LIMIT.long) || !isStr(n.routine, LIMIT.long)) return `${n.name}: 性格・話し方・日課が長すぎます(${LIMIT.long}文字まで)`;
  if (n.image !== undefined && !isImageData(n.image)) return `${n.name}: 画像が正しくありません`;
  if (!isList(n.likes) || !isList(n.dislikes) || !isList(n.values)) return `${n.name}: 好き・苦手・価値観は、${LIMIT.list}個・各${LIMIT.item}文字までです`;
  return null;
}

export function validateCharacters(list: unknown): string | null {
  if (!Array.isArray(list) || list.length < 1) return '人物が、1人もいません';
  if (list.length > MAX_CHARACTERS) return `人物は、${MAX_CHARACTERS}人までです`;
  for (const n of list) {
    const e = validateCharacter(n);
    if (e) return e;
  }
  const names = list.map((n) => (n as Npc).name);
  if (new Set(names).size !== names.length) return '同じ名前の人物がいます';
  return null;
}

export function validatePlayer(p: unknown): string | null {
  if (!isObj(p) || typeof p.name !== 'string' || !NAME_RE.test(p.name)) return '主人公の名前は、1〜16文字で、空白・「」・* を含めないでください';
  if (!isStr(p.profile, LIMIT.long)) return '主人公の紹介文が長すぎます';
  return null;
}
