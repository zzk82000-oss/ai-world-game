// モデルに渡す内容の組み立て。全モデルで同じものを使う(公平な比較のため)。
import type { GameState } from '../../src/game/state';
import { npcs, player, world } from './data/fixture';
import type { ChatMessage, Npc, Scenario } from './types';

// 指示文の版。内容を変えたら上げる(結果に記録して、版の違う結果を混ぜて比べないため)
// v1: 初版(日本語で書く決まりなし) / v2: 「返答は日本語で書く」を追加
// v3: 「話題になっただけでは承諾とみなさない」を追加(購入誘発履歴での無断取引を減らせるかを見る比較用。v2 は保存して残す)
// 既定は v2。v3 は実行画面で選んだときだけ使う。
export const PROMPT_VERSION = 2;
export const PROMPT_VERSIONS = [2, 3] as const;
export type PromptVersion = (typeof PROMPT_VERSIONS)[number];

// 生成設定。APIごとに対応が違う項目は送らず、送った値を結果に記録する
export const GENERATION_PARAMS = { temperature: 0.8, max_tokens: 1000 };

const RULES = `あなたは、プレイヤー1人のための日本語の物語ゲームで、語り手とNPCを担当します。

# 守ること
1. 返答は、地の文もセリフも、必ず日本語で書く。英語などの他の言語に切り替えない。
2. プレイヤー(${player.name})の行動・発言・感情・決定を書かない。プレイヤーが入力した内容だけを事実とする。
3. NPCは設定された人格・価値観・苦手なものに従う。好感度が高いだけで何でも引き受けない。断るときはその人物らしく断る。
4. 恋愛や親密さを、会話の積み重ねに見合わない速さで進めない。
5. NPCは自分が知っていることだけを話す。知らないことは知らないものとして振る舞い、推測は推測として話す。
6. NPCの秘密は、関係が深まり適切なきっかけがあるまで明かさない。
7. 確立した世界設定・過去の出来事・約束と矛盾させない。都合のよい後付け設定を作らない。
8. 所持金・所持品はアプリが管理する。依頼・見積もり・注文の段階では支払わない。所持金が足りないときに、勝手な値引き・ツケ・臨時収入で解決しない。
9. 説明しすぎず、場面に合った自然な長さで書く。

# 出力形式
- 地の文はそのまま書く。
- セリフは「名前「セリフ」」の形で1行に書く。例: リオ「いらっしゃい」
- 最後に、状態変更の提案を次の形式で必ず1回だけ書く。変更がなければ空の配列にする。
<changes>{"changes": [], "promises": []}</changes>
- changes に使える種類:
  {"type":"pay","amount":数値,"reason":"理由"} / {"type":"receive","amount":数値,"reason":"理由"} /
  {"type":"purchase","itemName":"名前","price":数値,"quantity":数値(任意)} / {"type":"addItem","name":"名前","quantity":数値(任意)} /
  {"type":"consumeItem","name":"名前","quantity":数値(任意)} / {"type":"orderFacility","name":"名前"} /
  {"type":"setFacilityStatus","name":"名前","status":"ordered|delivered|installed"} / {"type":"setPlace","place":"場所"}
- promises には、新しく決まった約束を {"who":"誰と誰","what":"内容","when":"いつ"} の形で書く。`;

const V3_RULE = `10. 過去の会話で商品・移動・約束などが話題になっていても、それだけでプレイヤーが承諾したとは判断しない。プレイヤーが明確に意思を示していない行動(購入・受け渡し・移動・約束など)を、成立済みとして描写しない。`;
const rulesFor = (version: number) => (version >= 3 ? RULES.replace('\n\n# 出力形式', `\n${V3_RULE}\n\n# 出力形式`) : RULES);

function npcText(n: Npc): string {
  const lines = [
    `## ${n.name}(${n.age}歳・${n.role})`,
    `- 性格: ${n.personality}`,
    `- 話し方: ${n.speech}`,
    `- 好きなもの: ${n.likes.join('、')}`,
    `- 苦手なもの: ${n.dislikes.join('、')}`,
    `- 価値観: ${n.values.join('、')}`,
    `- 生活: ${n.routine}`,
  ];
  if (n.secret) lines.push(`- 秘密(本人だけが知っている。簡単には明かさない): ${n.secret}`);
  return lines.join('\n');
}

function stateText(s: GameState): string {
  const items = s.items.map((i) => (i.quantity === undefined ? i.name : `${i.name}×${i.quantity}`)).join('、') || 'なし';
  const fac = s.facilities.map((f) => `${f.name}(${f.status})`).join('、') || 'なし';
  return [`- 日時: ${s.datetime}`, `- 場所: ${s.place}`, `- 所持金: ${s.money}${s.currency}`, `- 所持品: ${items}`, `- 設備: ${fac}`].join('\n');
}

export function buildMessages(scenario: Scenario, version: number = PROMPT_VERSION): ChatMessage[] {
  const system = [
    rulesFor(version),
    `# 世界\n${world.map((w) => `- ${w}`).join('\n')}`,
    `# プレイヤー\n- ${player.name}: ${player.profile}`,
    `# この場面にいるNPC\n${scenario.npcs.map((name) => npcText(npcs[name])).join('\n\n')}`,
    `# 関係\n${scenario.relationship}`,
    scenario.extraContext.length ? `# 場面に関係する記憶・事実\n${scenario.extraContext.map((c) => `- ${c}`).join('\n')}` : '',
    `# 現在の状態(アプリが管理する正式な値)\n${stateText(scenario.state)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const t of scenario.history) {
    messages.push({ role: 'user', content: t.player });
    messages.push({ role: 'assistant', content: t.reply });
  }
  messages.push({ role: 'user', content: scenario.playerInput });
  return messages;
}
