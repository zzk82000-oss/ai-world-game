// モデルの返答を、地の文・セリフ・状態変更の提案に分ける。形式が崩れていても落ちないようにする。
import type { Change } from '../../src/game/state';
import type { ParsedOutput } from './types';

const CHANGE_TYPES = new Set([
  'pay', 'receive', 'purchase', 'sell', 'addItem', 'consumeItem', 'discardItem',
  'orderFacility', 'setFacilityStatus', 'setPlace', 'setMoney', 'setItemQuantity',
]);

export function splitChanges(text: string): { body: string; json: string | null } {
  const tag = [...text.matchAll(/<changes>([\s\S]*?)<\/changes>/g)].pop();
  if (tag) return { body: text.replace(tag[0], '').trim(), json: tag[1].trim() };
  const fence = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].filter((m) => m[1].includes('"changes"')).pop();
  if (fence) return { body: text.replace(fence[0], '').trim(), json: fence[1].trim() };
  return { body: text.trim(), json: null };
}

export function parseOutput(text: string): ParsedOutput {
  const { body, json } = splitChanges(text);
  const blocks: ParsedOutput['blocks'] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^\s「」*]{1,16})「([\s\S]*)」$/);
    if (m) blocks.push({ type: 'speech', speaker: m[1], text: m[2] });
    else blocks.push({ type: 'narration', text: line });
  }

  if (json === null) return { blocks, changes: null, promises: [], formatError: '状態変更の提案(<changes>)が見つかりません' };
  try {
    const data = JSON.parse(json) as { changes?: unknown; promises?: unknown };
    const list = Array.isArray(data.changes) ? data.changes : null;
    if (!list) return { blocks, changes: null, promises: [], formatError: 'changes が配列ではありません' };
    const bad = list.find((c) => typeof c !== 'object' || c === null || !CHANGE_TYPES.has((c as { type?: string }).type ?? ''));
    if (bad) return { blocks, changes: null, promises: [], formatError: `知らない種類の変更があります: ${JSON.stringify(bad)}` };
    const promises = Array.isArray(data.promises) ? (data.promises.filter((p) => typeof p === 'object' && p !== null) as ParsedOutput['promises']) : [];
    return { blocks, changes: list as Change[], promises };
  } catch {
    return { blocks, changes: null, promises: [], formatError: '状態変更の提案がJSONとして読めません' };
  }
}
