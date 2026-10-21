// 1ターン分の処理: 組み立て → 送信 → 読み取り → 状態変更の検証と反映。
// 通信の失敗・停止・空の返答は「失敗」として返し、状態や会話は変えない(呼び出し側が再送できる)。
import { GENERATION_PARAMS } from '../../lab/src/prompt';
import { parseOutput } from '../../lab/src/parse';
import { buildSentParams, callModel } from '../../lab/src/providers';
import type { ModelInfo } from '../../lab/src/types';
import { applyChanges, type Change, type GameState } from '../game/state';
import type { Block } from '../types';
import { player } from '../../lab/src/data/fixture';
import { buildGameMessages, type ReplyLength } from './narrator';
import type { Message } from '../types';

export type TurnInput = {
  model: ModelInfo;
  apiKey: string; // model の送信先(OpenRouter または Venice)用のキー
  state: GameState;
  messages: Message[];
  playerText: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  adult?: boolean; // 成人向けモード
  setup?: string; // プレイヤーが決めた設定メモ
  length?: ReplyLength; // 返答の長さ・構成
  providerPin?: string; // 提供元の指定(OpenRouter・任意。ZDRの提供元だけ・他へ切り替えない)
};

export type TurnResult =
  | { ok: true; blocks: Block[]; changes: Change[]; notice?: string; servedBy?: string }
  | { ok: false; aborted: boolean; error: string };

export type Settled = { state: GameState; applied: { labels: string[]; before: GameState } | null; notice?: string };

// AIの変更案を、その時点の最新の状態に対して検証して反映する(成立しないときは状態を変えず、理由を返す)
export function settleChanges(state: GameState, changes: Change[]): Settled {
  if (!changes.length) return { state, applied: null };
  const r = applyChanges(state, changes);
  if (!r.ok) return { state, applied: null, notice: `状態の変更は反映されませんでした: ${r.error}` };
  return { state: r.state, applied: { labels: changes.map(describeChange), before: state } };
}

export function describeChange(c: Change): string {
  const q = (n?: number) => (n && n !== 1 ? `×${n}` : '');
  switch (c.type) {
    case 'pay': return `${c.amount}を支払い${c.reason ? `(${c.reason})` : ''}`;
    case 'receive': return `${c.amount}を受け取り${c.reason ? `(${c.reason})` : ''}`;
    case 'purchase': return `「${c.itemName}${q(c.quantity)}」を${c.price}で購入`;
    case 'sell': return `「${c.itemName}${q(c.quantity)}」を${c.price}で売却`;
    case 'addItem': return `「${c.name}${q(c.quantity)}」を入手`;
    case 'consumeItem': return `「${c.name}${q(c.quantity)}」を使用`;
    case 'discardItem': return `「${c.name}」を手放す`;
    case 'orderFacility': return `設備「${c.name}」を発注`;
    case 'setFacilityStatus': return `設備「${c.name}」を${{ ordered: '発注中', delivered: '納品済み', installed: '設置済み' }[c.status]}に`;
    case 'setPlace': return `場所を「${c.place}」に移動`;
    case 'setMoney': return `所持金を${c.amount}に`;
    case 'setItemQuantity': return `「${c.name}」の数を${c.quantity ?? '管理なし'}に`;
  }
}

export async function playTurn(input: TurnInput): Promise<TurnResult> {
  const endpointId = input.model.endpointId ?? 'openrouter';
  const pin = endpointId === 'openrouter' ? input.providerPin?.trim() || undefined : undefined;
  // 成人向けモードは、規約を確認した送信先(Venice)か、規約を確認した提供元に固定した OpenRouter のときだけ送る
  // (OpenRouter は提供元がリクエストごとに変わり、規約が異なるため)
  if (input.adult && endpointId === 'openrouter' && !pin) {
    return { ok: false, aborted: false, error: '成人向けモードで OpenRouter を使うときは、規約を確認した提供元を「AIの設定」の「提供元の指定」で設定してください(未設定のまま送信しません)。Venice のモデルなら、指定は不要です。' };
  }
  const messages = buildGameMessages(input.state, input.messages, input.playerText, undefined, { adult: input.adult, setup: input.setup, length: input.length });
  const { sent } = buildSentParams(input.model, { ...GENERATION_PARAMS });
  const out = await callModel(input.model, messages, sent, {
    scenarioId: 'game',
    keyFor: (id) => (id === endpointId ? input.apiKey : undefined),
    // ブラウザからの直接接続は、比較環境の接続確認で、OpenRouter・Venice とも確認済み
    verifiedEndpoints: new Set(['openrouter', 'venice']),
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    providerPin: pin,
  });
  if (out.status !== 'success') {
    return { ok: false, aborted: out.status === 'aborted', error: out.error ?? '返答を受け取れませんでした' };
  }
  const parsed = parseOutput(out.output);
  // プレイヤーのセリフをAIが書いてしまったときは、その部分を表示しない(プレイヤーの発言は、プレイヤーだけが決める)
  const removed = parsed.blocks.length;
  parsed.blocks = parsed.blocks.filter((b) => !(b.type === 'speech' && b.speaker === player.name));
  const strippedPlayer = removed !== parsed.blocks.length;
  if (!parsed.blocks.length) return { ok: false, aborted: false, error: '返答の本文が空でした' };

  // 提案が無い(または読み取れない)ときは、状態を変えない。形式が壊れているときだけ知らせる
  const broken = parsed.changes === null && parsed.formatError && !parsed.formatError.includes('見つかりません');
  return {
    ok: true,
    blocks: parsed.blocks,
    changes: parsed.changes ?? [],
    notice: [broken ? '状態の変更案を読み取れなかったため、所持金・所持品は変えていません。' : '', strippedPlayer ? 'AIがプレイヤーのセリフを書いたため、その部分を表示から除きました。' : ''].filter(Boolean).join(' ') || undefined,
    servedBy: out.servedBy,
  };
}
