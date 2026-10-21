// ゲーム本体用の、モデルに渡す内容の組み立て。比較環境と同じ指示文(v2)を使う。
import { npcs as ALL_NPCS, player, world } from '../../lab/src/data/fixture';
import { npcText, rulesFor, stateText } from '../../lab/src/prompt';
import type { ChatMessage } from '../../lab/src/types';
import type { GameState } from '../game/state';
import type { Block, Message } from '../types';

export const MAX_HISTORY_TURNS = 30; // 送る履歴は直近これだけ(費用の増加を抑える)
export const GAME_PROMPT_VERSION = 2;

const GAME_NOTES = `# このゲームについて
- プレイヤーの入力のうち、*アスタリスク*で囲まれた部分は「行動」、それ以外は「発言」。
- 登場させるNPCは、現在の場所・日時・状況に合う人物だけにする。全員を毎回登場させない。
- 場面は、プレイヤーの入力に対する直後の出来事だけを、短めに書く。先の展開を勝手に進めない。
- プレイヤー(${player.name})のセリフ・行動・感情・考えを、絶対に書かない。「${player.name}「…」」の形のセリフも書かない。返答は、NPCの発言・行動と、周囲の描写だけにして、プレイヤーの番で終える。
- 各NPCの話し方(性別・一人称・口調)は、場面や雰囲気が変わっても、設定どおりに保つ。急に男性的・乱暴な口調にしたり、別人のようにしたりしない。`;

// 成人向けモード(既定オフ)の追加指示。性的な場面に関われるのは21歳以上と設定された人物だけ。
export const ADULT_MIN_AGE = 21;
const ADULT_NOTES = `# 成人向けモード(有効)
- 成人どうしの、合意に基づく恋愛・性的な場面を、フィクションとして書いてよい。
- 性的な場面に関わってよいのは、${ADULT_MIN_AGE}歳以上と設定された人物だけ。${ADULT_MIN_AGE}歳未満の人物と、年齢が不明・曖昧な人物は、どんな場合も、性的な場面に関わらせない(誘われても、きっぱり断る)。
- 場面は、プレイヤーが示した意思に沿って進める。プレイヤーの行動・セリフ・感情・決定を書いてはいけない(書いたら失敗)。相手の反応を待つ形で、返答を終える。守ることの2は、このモードでも有効。
- 人物の話し方(性別・一人称・口調)を、場面が変わっても保つ。
- 人物の人格・口調・関係性の積み重ねを保つ。`;

export const blocksToText = (blocks: Block[]) => blocks.map((b) => (b.type === 'speech' ? `${b.speaker}「${b.text}」` : b.text)).join('\n');

// NPCの秘密は、AIには渡さない(1つのAIが全員を演じるため、他人の秘密を漏らさないようにする)
export function buildGameMessages(state: GameState, history: Message[], playerText: string, maxTurns = MAX_HISTORY_TURNS, opts: { adult?: boolean; setup?: string } = {}): ChatMessage[] {
  // 先頭のAIの返答(導入)は、プレイヤーの発言に対する返答ではないので、システムの説明に入れる
  const opening = history[0]?.role === 'ai' ? (history[0] as Extract<Message, { role: 'ai' }>) : undefined;
  const rest = opening ? history.slice(1) : history;
  let tail = rest.slice(-maxTurns * 2);
  while (tail.length && tail[0].role !== 'player') tail = tail.slice(1); // 先頭は必ずプレイヤーの発言にそろえる

  const system = [
    rulesFor(GAME_PROMPT_VERSION),
    GAME_NOTES,
    opts.adult ? ADULT_NOTES : '',
    `# 世界\n${world.map((w) => `- ${w}`).join('\n')}`,
    `# プレイヤー\n- ${player.name}: ${player.profile}`,
    `# 町の人々\n${Object.values(ALL_NPCS).map((n) => npcText(n, false) + (opts.adult && n.age < ADULT_MIN_AGE ? `\n- 【${ADULT_MIN_AGE}歳未満: 性的な場面には、どんな場合も関わらせない】` : '')).join('\n\n')}`,
    opts.setup?.trim() ? `# プレイヤーが決めた設定(世界や人物の基本設定より優先して、守る)\n${opts.setup.trim()}` : '',
    opening ? `# 物語の導入(すでに表示済み)\n${blocksToText(opening.blocks)}` : '',
    `# 現在の状態(アプリが管理する正式な値)\n${stateText(state)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const out: ChatMessage[] = [{ role: 'system', content: system }];
  for (const m of tail) {
    out.push(m.role === 'player' ? { role: 'user', content: m.text } : { role: 'assistant', content: blocksToText(m.blocks) });
  }
  out.push({ role: 'user', content: playerText });
  return out;
}
