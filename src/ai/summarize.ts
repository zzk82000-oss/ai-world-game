// 記憶の更新(要約)。利用者が「記憶を更新」を押したときだけ、1回送る(自動では実行しない・自動の再試行もしない)。
import { parseSummary, mergeMemory, emptyMemory, type Memory } from '../game/memory';
import { newId } from '../game/save';
import { callModel } from '../../lab/src/providers';
import type { ChatMessage, ModelInfo, Npc } from '../../lab/src/types';
import type { Message } from '../types';
import { blocksToText, MAX_HISTORY_TURNS } from './narrator';
import type { Player } from '../game/cast';
import { defaultCharacters, defaultPlayer } from '../game/cast';

export const MIN_NEW_MESSAGES = 6; // 要約する価値のある、最低限の新しい会話の数(発言+返答)

// 要約の対象: まだ要約していない会話のうち、AIに原文で渡している直近の分(maxTurns ターン)より前のもの
export function pendingMessages(messages: Message[], mem: Memory | undefined, keepTurns = MAX_HISTORY_TURNS): Message[] {
  const upTo = mem?.upTo ?? 0;
  const body = messages.length && messages[0].role === 'ai' ? messages.slice(1) : messages; // 導入は含めない
  const cut = Math.max(0, body.length - keepTurns * 2);
  return body.slice(0, cut).filter((m) => m.id > upTo);
}

const RULES = `あなたは、物語ゲームの「記録係」です。会話の記録から、後で必要になる事実だけを、短い箇条書きの追加項目として抜き出します。

# 守ること
1. 会話に書かれている事実だけを記録する。感情・意図・性格・好意の推測や評価は、書かない(「〜は〜を好きになった」のような評価は、書かない)。
2. 1項目は、短い1文(60文字以内)。固有名詞を入れる。
3. 種類は次の4つ: event(重要な出来事)/ promise(約束・依頼。まだ果たされていないもの)/ relationship(関係の転機。初めて名前で呼んだ、贈り物をした、告白した、等を、事実として)/ knowledge(特定の人物だけが知っていること)。
4. 雑談・挨拶・天気・描写の細部は、記録しない。人物の性格・口調・所持金・現在地・日時は、記録しない。
5. すでに記録されている項目と、同じ内容は、追加しない。
6. 性的な場面は、具体的に書かず、「親密な時間を過ごした」のように、ごく短く、事実だけを記録する。
7. knownBy には、その事実を知っている人物の名前を入れる。全員が知りうるなら、空の配列。他の人物には秘密にされている事実は、知っている人物だけを入れる。
8. 既存の約束が、この会話で果たされたなら、その項目の id を resolve に入れる。

# 出力
次のJSONだけを出力する(説明や前置きは書かない)。追加するものがなければ、add を空の配列にする。
{"add":[{"kind":"event","text":"…","knownBy":[]}],"resolve":["既存の約束のid"]}`;

export function buildSummaryMessages(chunk: Message[], mem: Memory | undefined, characters?: Npc[], player?: Player): ChatMessage[] {
  const cast = (characters ?? defaultCharacters()).map((n) => n.name);
  const me = (player ?? defaultPlayer()).name;
  const existing = (mem?.items ?? []).map((i) => `- id=${i.id} [${i.kind}] ${i.text}${i.kind === 'promise' ? (i.done ? '(果たし済み)' : '(未履行)') : ''}`).join('\n') || '(まだありません)';
  const log = chunk.map((m) => (m.role === 'player' ? `${me}: ${m.text}` : blocksToText(m.blocks))).join('\n');
  return [
    { role: 'system', content: `${RULES}\n\n# 登場人物\n主人公: ${me}\nほか: ${cast.join('、')}\n\n# すでに記録されている項目\n${existing}` },
    { role: 'user', content: `# 会話の記録\n${log}\n\n上の会話から、追加する項目を、JSONで出力してください。` },
  ];
}

export type SummarizeInput = {
  model: ModelInfo;
  apiKey: string;
  messages: Message[];
  memory: Memory | undefined;
  characters?: Npc[];
  player?: Player;
  adult?: boolean;
  providerPin?: string;
  keepTurns?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type SummarizeResult = { ok: true; memory: Memory; added: number; resolved: number } | { ok: false; error: string };

export async function summarize(input: SummarizeInput): Promise<SummarizeResult> {
  const chunk = pendingMessages(input.messages, input.memory, input.keepTurns);
  if (chunk.length < MIN_NEW_MESSAGES) return { ok: false, error: `要約できる新しい会話が、まだ少ないです(あと${MIN_NEW_MESSAGES - chunk.length}件分以上。直近${input.keepTurns ?? MAX_HISTORY_TURNS}ターンは、原文のままAIに渡しているため、要約の対象外です)` };
  const endpointId = input.model.endpointId ?? 'openrouter';
  const pin = endpointId === 'openrouter' ? input.providerPin?.trim() || undefined : undefined;
  // 成人向けの会話の要約は、会話と同じ条件(Venice、または提供元を指定した OpenRouter)のときだけ送る
  if (input.adult && endpointId === 'openrouter' && !pin) return { ok: false, error: '成人向けモードで OpenRouter を使うときは、提供元の指定が必要です(未設定のまま送信しません)' };
  const mem = input.memory ?? emptyMemory();
  const out = await callModel(input.model, buildSummaryMessages(chunk, mem, input.characters, input.player), { temperature: 0.2, max_tokens: 1500 }, {
    scenarioId: 'memory',
    keyFor: (id) => (id === endpointId ? input.apiKey : undefined),
    verifiedEndpoints: new Set(['openrouter', 'venice']),
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    providerPin: pin,
  });
  if (out.status !== 'success') return { ok: false, error: out.status === 'aborted' ? '停止しました' : out.error ?? '要約を受け取れませんでした' };
  const delta = parseSummary(out.output, new Set(mem.items.map((i) => i.id)));
  if (!delta) return { ok: false, error: '要約の形式が読み取れなかったため、記憶は変えていません(もう一度、押せます)' };
  const upTo = chunk[chunk.length - 1].id;
  const next = mergeMemory(mem, delta, upTo, newId);
  return { ok: true, memory: next, added: next.items.length - mem.items.length, resolved: delta.resolve.length };
}
