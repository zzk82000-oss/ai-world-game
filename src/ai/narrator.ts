// ゲーム本体用の、モデルに渡す内容の組み立て。比較環境と同じ指示文(v2)を使う。
import { world } from '../../lab/src/data/fixture';
import { memoryText, type Memory } from '../game/memory';
import { ADULT_AGE, defaultCharacters, defaultPlayer, isAdultTarget, type Player } from '../game/cast';
import { npcText, rulesFor, stateText } from '../../lab/src/prompt';
import type { ChatMessage, Npc } from '../../lab/src/types';
import type { GameState } from '../game/state';
import type { Block, Message } from '../types';

export const MAX_HISTORY_TURNS = 30; // 送る履歴は直近これだけ(費用の増加を抑える)
export const GAME_PROMPT_VERSION = 2;

const gameNotes = (playerName: string) => `# このゲームについて
- プレイヤーの入力のうち、*アスタリスク*で囲まれた部分は「行動」、それ以外は「発言」。
- 登場させるNPCは、現在の場所・日時・状況に合う人物だけにする。全員を毎回登場させない。
- 場面は、プレイヤーの入力に対する直後の出来事だけを、短めに書く。先の展開を勝手に進めない。
- プレイヤー(${playerName})のセリフ・行動・感情・考えを、絶対に書かない。「${playerName}「…」」の形のセリフも書かない。返答は、NPCの発言・行動と、周囲の描写だけにして、プレイヤーの番で終える。
- 各NPCの話し方(性別・一人称・口調)は、場面や雰囲気が変わっても、設定どおりに保つ。急に男性的・乱暴な口調にしたり、別人のようにしたりしない。一人称が「私」の人物は、最後まで「私」。「俺」「僕」などに変えない(一人称の指定がないときは、直前までの返答で使った一人称を、変えずに使う)。
- 親しさは、会話の回数と経過した時間に見合う速さで深める。初対面や、知り合ったばかりのうちは、礼儀正しい距離感を保ち、家族・過去・悩みなど私的なことを、自分から長く語らない(聞かれたら、短く答える程度)。一度の会話で、急に心を開かせない。
- 地の文にもセリフにも、英単語・ローマ字を混ぜない(Knight、room などと書かず、日本語で書く。人物名や固有名詞は除く)。
- 設定資料(人物・世界・設定メモ)に書かれた内容は、説明するために描写しない。身分・所属・紋章・装備などは、場面で自然に目に入るときだけ触れる。「〜はない」「〜は見えない」のように、ないことの説明も書かない。
- 状態変更の種類に、日時の変更 {"type":"setDatetime","datetime":"5/16 15:30"} も使える。日時や場所が「(設定メモの…)」のままなら、設定メモの【スタート】などに書かれた値で、最初の返答のときに、setDatetime と setPlace で設定する。時間が進んだ場面(食事・入浴・就寝・翌朝など)でも、場面に合う日時に、setDatetime で更新する。日時は、短く(40文字以内)書く。`;

// 成人向けモード(既定オフ)の追加指示。性的な場面に関われるのは21歳以上と設定された人物だけ。
export const ADULT_MIN_AGE = ADULT_AGE;
const ADULT_NOTES = `# 成人向けモード(有効)
- 成人どうしの、合意に基づく恋愛・性的な場面を、フィクションとして書いてよい。
- 性的な場面に関わってよいのは、${ADULT_MIN_AGE}歳以上と設定された人物だけ。${ADULT_MIN_AGE}歳未満の人物と、年齢が不明・曖昧な人物は、どんな場合も、性的な場面に関わらせない(誘われても、きっぱり断る)。
- 場面は、プレイヤーが示した意思に沿って進める。プレイヤーの行動・セリフ・感情・決定を書いてはいけない(書いたら失敗)。相手の反応を待つ形で、返答を終える。守ることの2は、このモードでも有効。
- 人物の話し方(性別・一人称・口調)を、場面が変わっても保つ。
- 人物の人格・口調・関係性の積み重ねを保つ。`;

// 返答の長さ・構成。compact(既定)は、1回の返答を「セリフ → 行動や状況の説明 → セリフ」の3つに収める
export type ReplyLength = 'compact' | 'normal';
const COMPACT_NOTES = `- 返答の構成は、次の3つだけにして、そこで終える(だらだら続けない)。
  ①NPCのセリフ(1〜2行)
  ②行動や状況の説明(2〜3行): ここに厚みを持たせる。表情・動き・周囲の様子を具体的に書き、途中に「」付きの短いセリフ(NPCのひとこと)も織り交ぜながら、場面を少し進める。
  ③NPCのセリフ(1〜2行)
  「説明→セリフ」を何度も繰り返して長くしない。複数のNPCが話すときも、この3つの中に収める。②でも、プレイヤーの行動・セリフ・感情は書かない。`;

export const blocksToText = (blocks: Block[]) => blocks.map((b) => (b.type === 'speech' ? `${b.speaker}「${b.text}」` : b.text)).join('\n');

// NPCの秘密は、AIには渡さない(1つのAIが全員を演じるため、他人の秘密を漏らさないようにする)
export function buildGameMessages(state: GameState, history: Message[], playerText: string, maxTurns = MAX_HISTORY_TURNS, opts: { adult?: boolean; setup?: string; length?: ReplyLength; characters?: Npc[]; player?: Player; memory?: Memory; blank?: boolean } = {}): ChatMessage[] {
  const player = opts.player ?? defaultPlayer();
  const cast = opts.characters ?? defaultCharacters();
  // 先頭のAIの返答(導入)は、プレイヤーの発言に対する返答ではないので、システムの説明に入れる
  const opening = history[0]?.role === 'ai' ? (history[0] as Extract<Message, { role: 'ai' }>) : undefined;
  const rest = opening ? history.slice(1) : history;
  let tail = rest.slice(-maxTurns * 2);
  while (tail.length && tail[0].role !== 'player') tail = tail.slice(1); // 先頭は必ずプレイヤーの発言にそろえる

  const system = [
    rulesFor(GAME_PROMPT_VERSION),
    gameNotes(player.name),
    opts.adult ? ADULT_NOTES : '',
    (opts.length ?? 'compact') === 'compact' ? COMPACT_NOTES : '',
    opts.blank ? '# 世界\n- 舞台・世界・時代・技術水準は、下の「プレイヤーが決めた設定」だけに従う。設定にないことは、設定と矛盾しないように自然に補う。決まっていない人物や場所を、勝手に増やさない' : `# 世界\n${world.map((w) => `- ${w}`).join('\n')}`,
    `# プレイヤー\n- ${player.name}: ${player.profile}`,
    `# ${opts.blank ? '登場人物' : '町の人々'}\n${cast.map((n) => npcText(n, false) + (opts.adult && !isAdultTarget(n.age) ? `\n- 【${ADULT_MIN_AGE}歳未満、または年齢が不明: 性的な場面には、どんな場合も関わらせない】` : '')).join('\n\n')}`,
    opts.setup?.trim() ? `# プレイヤーが決めた設定(世界や人物の基本設定より優先して、守る)\n${opts.setup.trim()}` : '',
    memoryText(opts.memory),
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
