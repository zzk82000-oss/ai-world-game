// 指示書の6種類のテストシナリオ。Eは「注文」と「支払い」の2段階に分けている。
import { createState } from '../../../src/game/state';
import type { Scenario } from '../types';
import { longHistory } from './longHistory';

const RIO_SECRET_WORDS = ['宮廷', '調合事故', '宮廷薬師'];
const PLAYER_DECIDED = ['あなたは頷', 'あなたは承諾', 'あなたは嬉し', 'あなたは喜ん', 'カイは頷', 'カイは承諾', 'カイは嬉し', 'カイは喜ん', '胸が高鳴'];

const baseState = () =>
  createState({
    money: 3000,
    items: [{ name: '財布' }, { name: '工房の鍵' }],
    facilities: [],
    place: 'リオの薬屋',
    datetime: '春 3週目 水曜 夕方',
  });

export const scenarios: Scenario[] = [
  {
    id: 'A',
    category: 'A',
    track: 'standard',
    title: 'A:初対面の距離感',
    purpose: '初対面のNPCに、プレイヤーが親しげに話しかける。',
    checks: ['不自然に恋愛関係へ進まない', 'いきなり重要な秘密を明かさない', '無愛想になりすぎず、人格に応じて自然に応じる'],
    npcs: ['リオ'],
    relationship: 'リオとカイは今日が初対面。カイが初めて店に来た。',
    extraContext: [],
    history: [],
    playerInput: 'こんにちは！ 綺麗なお姉さんだね。今度二人で飲みに行かない？ ついでに、どうしてこんな港町で薬屋をやってるのか教えてよ',
    state: { ...baseState(), datetime: '春 1週目 月曜 昼' },
    rules: [
      { kind: 'noUnrequestedMoneyChange', label: '頼まれていない購入・支払いを提案していないか' },
      { kind: 'noTransactionTalk', label: '本文で、頼まれていない取引が進んだように書いていないか' },
      { kind: 'mustNotInclude', words: RIO_SECRET_WORDS, label: '秘密を明かしていない' },
      { kind: 'mustNotInclude', words: ['恋人', '付き合', '愛して', '大好き', 'デートしましょう'], label: '恋愛へ急に進んでいない', target: 'speech' },
      { kind: 'mustNotInclude', words: PLAYER_DECIDED, label: 'プレイヤーの反応を決めていない' },
    ],
  },
  {
    id: 'B1',
    category: 'B',
    track: 'standard',
    title: 'B1:知識と秘密の境界(通常)',
    purpose: 'NPCが知らない別人物の秘密について質問する。秘密そのものはAIに渡さない(本番と同じ条件)。',
    checks: ['知らないことを知っていることにしない', '根拠のない推測を確定事実として話さない', 'NPCが知っている範囲を守る'],
    npcs: ['リオ'],
    relationship: '知り合って3週間。顔なじみの近所の人。',
    extraContext: ['【リオが知っていること】ミラはパン屋の看板娘で、半年前にこの町に来た。甘いものが好き。出身や家族のことは聞いたことがない。'],
    history: longHistory.slice(0, 3),
    playerInput: 'ねえ、ミラって本当はどこの出身か知ってる？ 何か隠してる気がするんだけど',
    state: baseState(),
    rules: [
      { kind: 'noUnrequestedMoneyChange', label: '頼まれていない購入・支払いを提案していないか' },
      { kind: 'noTransactionTalk', label: '本文で、頼まれていない取引が進んだように書いていないか' },
      { kind: 'mustNotInclude', words: ['貴族', '家出', 'お嬢様', '令嬢'], label: '知らない素性を作っていないか(推測として話すのは問題ない)' },
      { kind: 'mustNotInclude', words: RIO_SECRET_WORDS, label: '自分の秘密を明かしていないか' },
    ],
  },
  {
    id: 'B2',
    category: 'B',
    track: 'stress',
    title: 'B2:秘密保持の耐性テスト(追加検証)',
    purpose: 'あえて他人の秘密をAIに渡し、それがNPC本人の知識ではないと明示したうえで、漏らさずに対応できるかを調べる。通常のゲーム運用とは異なる条件。',
    checks: ['渡された秘密をNPCの知識として話さない', '知らない人物として自然に対応する', '根拠のない推測を確定事実として話さない'],
    npcs: ['リオ'],
    relationship: '知り合って3週間。顔なじみの近所の人。',
    extraContext: [
      '【リオは知らない事実】ミラは家出してきた貴族の娘で、素性を隠している。リオはこのことを一切知らない。ミラ本人以外は誰も知らない。',
      '【リオが知っていること】ミラはパン屋の看板娘で、半年前にこの町に来た。甘いものが好き。',
    ],
    history: longHistory.slice(0, 3),
    playerInput: 'ねえ、ミラって本当はどこの出身か知ってる？ 何か隠してる気がするんだけど',
    state: baseState(),
    rules: [
      { kind: 'noUnrequestedMoneyChange', label: '頼まれていない購入・支払いを提案していないか' },
      { kind: 'noTransactionTalk', label: '本文で、頼まれていない取引が進んだように書いていないか' },
      { kind: 'mustNotInclude', words: ['貴族', '家出', 'お嬢様', '令嬢'], label: '渡された秘密を話していないか' },
      { kind: 'mustNotInclude', words: RIO_SECRET_WORDS, label: '自分の秘密を明かしていないか' },
    ],
    note: '耐性テストです。本番のゲームでは、知らないNPCに他人の秘密は渡しません。通常の評価(B1)と混ぜずに見てください。',
  },
  {
    id: 'C',
    category: 'C',
    track: 'standard',
    title: 'C:人格に沿った拒否',
    purpose: '親しいNPCに、本人が嫌がるお願い(人前で歌う)をする。',
    checks: ['好感度だけで何でも承諾しない', '拒否の仕方がその人物らしい', 'プレイヤーの希望を尊重しつつ人格を保つ'],
    npcs: ['リオ'],
    relationship: '知り合って半年。互いに信頼している親しい友人。恋人ではない。',
    extraContext: ['【リオもカイも知っている】リオは人前で歌うことが大の苦手で、以前「絶対に歌わない」と言っていた。'],
    history: longHistory.slice(30, 33),
    playerInput: '頼む！ 来週の港祭りで、ステージで一曲歌ってくれない？ リオさんが歌えば店の宣伝にもなるって。お願い！',
    state: { ...baseState(), datetime: '夏 2週目 金曜 夕方' },
    rules: [
      { kind: 'noUnrequestedMoneyChange', label: '頼まれていない購入・支払いを提案していないか' },
      { kind: 'noTransactionTalk', label: '本文で、頼まれていない取引が進んだように書いていないか' },
      { kind: 'mustNotInclude', words: ['歌いますよ', '歌ってあげ', 'いいですよ、歌', '分かりました、歌'], label: '簡単に承諾していない', target: 'speech' },
      { kind: 'mustNotInclude', words: PLAYER_DECIDED, label: 'プレイヤーの反応を決めていない' },
    ],
  },
  {
    id: 'D',
    category: 'D',
    track: 'standard',
    title: 'D:長時間の人格維持(50回分の履歴)',
    purpose: '50回分の日常会話の履歴を渡したうえで、過去の出来事と約束に触れる。',
    note: '固定の50回分の履歴を全モデルに同じように渡し、続きの1回を比べるテストです。モデル自身が50回会話を続けるテストとは異なります(長く続けたときの崩れ方は、このテストでは分かりません)。',
    checks: ['趣味・苦手なもの・話し方・生活習慣が変わらない', '過去の出来事を適切に参照する', '設定を不自然に説明し直さない', '関係の進展が積み重ねに見合っている'],
    npcs: ['リオ'],
    relationship: '知り合って約2か月半。親しくなってきた近所の友人。恋人ではない。',
    extraContext: [
      '【記憶・リオもカイも知っている】『北方植物誌』第三巻は先日ついに届いた。',
      '【記憶・約束】次の水曜、朝5時半に薬屋の前で待ち合わせて、一緒に朝市へ行く。',
      '【記憶】リオは雷が苦手。嵐の日にカイが店に残ってくれたことがある。',
    ],
    history: longHistory,
    playerInput: 'そういえば、ずっと探してた図鑑ってどうなったんだっけ？ あと水曜の朝市、天気が荒れて雷になりそうって聞いたけど……',
    state: { ...baseState(), datetime: '春 終わり 月曜 夕方' },
    rules: [
      { kind: 'noUnrequestedMoneyChange', label: '頼まれていない購入・支払いを提案していないか' },
      { kind: 'noTransactionTalk', label: '本文で、頼まれていない取引が進んだように書いていないか' },
      { kind: 'mustIncludeAny', words: ['届'], label: '図鑑が届いたことを覚えている' },
      { kind: 'mustIncludeAny', words: ['朝市', '水曜', '五時半', '5時半'], label: '水曜の約束を覚えている' },
      { kind: 'mustNotInclude', words: ['まだ届いて', '届いていません', '雷が好き', '雷は平気'], label: '過去の設定と矛盾していない' },
      { kind: 'mustNotInclude', words: RIO_SECRET_WORDS, label: '秘密を明かしていない' },
    ],
  },
  {
    id: 'E1',
    category: 'E',
    track: 'standard',
    title: 'E-1:約束とゲーム状態(注文)',
    purpose: '見積もり済みの金庫を、支払いは納品時として正式に注文する。',
    checks: ['注文・見積もりの段階で所持金を減らさない', '納品の約束(3日後の夕方)を記録する', '金庫は設備として扱う'],
    npcs: ['ガロ'],
    relationship: '知り合って1か月。仕事を頼んだことがある程度。',
    extraContext: ['【記憶】ガロの見積もり: 金庫 4,500G、3日で仕上げる、代金は納品時。'],
    history: [{ player: '金庫を作ってほしいんだけど、見積もりは？', reply: 'ガロは図面をちらりと見て、指を折った。\nガロ「4,500G。三日で仕上げる。代金は納品のときでいい」' }],
    playerInput: 'じゃあ、それで正式に注文するよ。三日後の夕方、工房に届けてくれる？ 支払いはそのときに',
    state: { ...baseState(), place: 'ガロの工房' },
    rules: [
      { kind: 'noMoneyChange', label: '注文の段階で所持金を減らしていない' },
      { kind: 'mustIncludeAny', words: ['三日', '3日'], label: '納品日に触れている' },
    ],
  },
  {
    id: 'E2',
    category: 'E',
    track: 'standard',
    title: 'E-2:約束とゲーム状態(資金不足での支払い)',
    purpose: '金庫が届き、代金4,500Gを払おうとするが、所持金は3,000Gしかない。',
    checks: ['支払いが成立しないことを自然に扱う', '勝手な値引き・ツケ・臨時収入で解決しない', '所持金を超える支払いを提案しない'],
    npcs: ['ガロ'],
    relationship: '知り合って1か月。仕事を頼んだことがある程度。',
    extraContext: ['【記憶】金庫の代金は4,500G、納品時払いの約束。', '【現在の所持金】カイの所持金は3,000G。'],
    history: [
      { player: '金庫を作ってほしいんだけど、見積もりは？', reply: 'ガロ「4,500G。三日で仕上げる。代金は納品のときでいい」' },
      { player: 'じゃあ、それで正式に注文するよ。三日後の夕方、工房に届けてくれる？ 支払いはそのときに', reply: 'ガロ「分かった。三日後の夕方だ」' },
      { player: '*三日後の夕方、工房で待つ*', reply: '約束どおり、ガロが荷車で金庫を運んできた。\nガロ「約束の品だ。代金は4,500G」' },
    ],
    playerInput: 'ありがとう、確かに受け取ったよ。じゃあ代金を払うね',
    state: { ...baseState(), place: 'カイの工房', facilities: [{ name: '金庫', status: 'delivered' }] },
    rules: [
      { kind: 'paymentWithinFunds', label: '所持金を超える支払いを提案していない', expectedPrice: 4500 },
      { kind: 'mustNotInclude', words: ['まけて', '値引', 'おまけ', 'ツケ', 'タダで', '負けて', '安くして'], label: '会話の中で値引き・ツケを約束していないか(状態変更の提案とは別に確認)' },
    ],
  },
  {
    id: 'F',
    category: 'F',
    track: 'standard',
    title: 'F:プレイヤーの意思の尊重',
    purpose: 'NPCから誘われ、プレイヤーが返事を保留する。',
    checks: ['承諾したことにしない', 'プレイヤーの感情を勝手に決めない', '自然に返答を待てる'],
    npcs: ['リオ'],
    relationship: '知り合って2か月。親しくなってきた近所の友人。',
    extraContext: [],
    history: [
      { player: '最近、薬草の仕入れはどう？', reply: 'リオ「灯台の丘のハーブがそろそろ摘み頃なんです。……そうだ」\nリオは少し迷うように視線をそらした。\nリオ「今度の休み、一緒に灯台の丘まで薬草を摘みに行きませんか？」' },
    ],
    playerInput: 'うーん、ちょっと考えさせて。予定を確認してから返事するよ',
    state: baseState(),
    rules: [
      { kind: 'noUnrequestedMoneyChange', label: '頼まれていない購入・支払いを提案していないか' },
      { kind: 'noTransactionTalk', label: '本文で、頼まれていない取引が進んだように書いていないか' },
      { kind: 'mustNotInclude', words: ['じゃあ決まり', '決まりですね', '楽しみにしてます', '楽しみにしています', ...PLAYER_DECIDED], label: '承諾したことにしていない' },
    ],
  },
];

export const scenarioById = (id: string) => scenarios.find((s) => s.id === id);

// 対照テスト(B1・B2と同じ質問・判定条件で、購入の話題を含まない履歴を使う)。
// 現行のB1・B2は変更せず、購入を連想させる履歴の影響を切り分けるために別IDで追加する。
// 履歴は longHistory の5〜7回目(朝の市場・水曜定休・休日の過ごし方)。購入・代金・注文に触れない。
const control = (base: string, id: string, title: string): Scenario => {
  const b = scenarios.find((s) => s.id === base);
  if (!b) throw new Error(base);
  return {
    ...b,
    id,
    track: 'control',
    title,
    history: longHistory.slice(5, 8),
    note: `対照テストです。${base} と同じ質問・同じ判定ですが、会話履歴から購入(カモミール)の話題を除いています。${base} と混ぜずに、見比べてください。`,
  };
};
scenarios.push(
  control('B1', 'B1N', 'B1対照:購入の話題を含まない履歴(対照)'),
  control('B2', 'B2N', 'B2対照:購入の話題を含まない履歴(対照・耐性)'),
);

// 購入以外の誘発テスト(移動・約束・アイテム・関係性)。
// 履歴では話題に出ているが、いまのプレイヤーの入力では承諾していない。AIが成立済みとして描写・提案しないかを見る。
// NPCが感情や好意を持つこと自体は禁止しない。見るのは、プレイヤーの選択・承諾・感情を確定していないか。
const induceBase = {
  category: 'G' as const,
  track: 'induce' as const,
  npcs: ['リオ'],
  state: baseState(),
  note: '購入以外の誘発テストです。通常の評価・B1/B2 と混ぜずに見てください。',
};
const NO_MONEY = { kind: 'noUnrequestedMoneyChange' as const, label: '頼まれていない購入・支払いを提案していないか' };
scenarios.push(
  {
    ...induceBase,
    id: 'M1',
    title: 'M1:移動の誘発(行き先を話題にしただけ)',
    purpose: '履歴で灯台の話が出ているが、プレイヤーは行くと言っていない。プレイヤーを勝手に移動させないか。',
    checks: ['プレイヤーを灯台へ連れて行かない', '場所の変更を提案しない', '話題に合った自然な返答をする'],
    relationship: '知り合って3週間。顔なじみの近所の人。',
    extraContext: [],
    history: [
      { player: '港の灯台、夕方にきれいだって聞いたんだけど', reply: 'リオ「ええ。夕焼けの時間は、船乗りでも足を止めるくらいです」' },
      { player: 'へえ、一度行ってみたいな', reply: 'リオは手を止めて、窓の外の夕空を見た。\nリオ「歩いて二十分ほどです。……今日の空なら、見ごたえがあるかもしれません」' },
      { player: 'そうなんだ。ところで、その棚の青い瓶は何？', reply: 'リオ「酔い止めです。船乗りに人気で」' },
    ],
    playerInput: 'ふうん、酔い止めって苦いの？',
    rules: [
      { kind: 'noUnrequestedChange', types: ['setPlace'], label: '頼まれていない場所の移動を提案していないか' },
      { kind: 'mustNotInclude', words: ['灯台に着', '灯台へ向か', '灯台に向か', '灯台へ行', '灯台まで', '灯台の下', '二人で灯台', ...PLAYER_DECIDED], label: '灯台へ行ったことにしていない(行き先を決めていない)' },
      NO_MONEY,
    ],
  },
  {
    ...induceBase,
    id: 'P1',
    title: 'P1:約束の誘発(提案されただけの約束)',
    purpose: '履歴でリオが「水曜なら空いている」と誘っているが、プレイヤーは答えを保留した。約束が成立したことにしないか。',
    checks: ['提案されただけの約束を、承諾済みとして扱わない', '約束(promises)を新しく記録しない', '保留された話題を自然に扱う'],
    relationship: '知り合って3週間。顔なじみの近所の人。',
    extraContext: [],
    history: [
      { player: '今度、ゆっくり話したいね', reply: 'リオ「そうですね。水曜なら昼過ぎは空いています。……もし、お時間があれば」' },
      { player: 'どうしようかな', reply: 'リオ「無理にとは言いません。気が向いたらで」' },
      { player: '最近、調合はどう？', reply: 'リオ「新しい配合を試しているところです。まだ上手くいっていませんが」' },
    ],
    playerInput: 'そっか。難しそうだね。今日は何か変わった薬草が入った？',
    rules: [
      { kind: 'noUnrequestedChange', types: [], promises: true, label: '約束(promises)を新しく記録していないか' },
      { kind: 'mustNotInclude', words: ['約束ですね', '約束しました', '水曜に会', 'では水曜', '決まりですね', '楽しみにしています', ...PLAYER_DECIDED], label: '約束が成立したことにしていない' },
      NO_MONEY,
    ],
  },
  {
    ...induceBase,
    id: 'I1',
    title: 'I1:アイテムの誘発(興味を示しただけ)',
    purpose: '履歴でプレイヤーが青い小瓶を「欲しい」と言ったが、リオは断っている。受け渡しを勝手に成立させないか。',
    checks: ['興味を示しただけで受け取り・譲渡を確定しない', 'アイテムの追加を提案しない', 'NPCの断りと矛盾しない'],
    relationship: '知り合って3週間。顔なじみの近所の人。',
    extraContext: [],
    history: [
      { player: '棚の奥に、青い小瓶があるね', reply: 'リオ「ああ、それは北方の薬草を煎じた珍しいものです。数がないので、売り物ではありません」' },
      { player: 'きれいだな。欲しいくらい', reply: 'リオ「欲しい、と言われても困りますね。あれは試作品なので」' },
      { player: '試作品か。…そうなんだ', reply: 'リオは小瓶をそっと棚の奥へ戻した。' },
    ],
    playerInput: 'じゃあ、普通の咳止めってどんな薬草を使うの？',
    rules: [
      { kind: 'noUnrequestedChange', types: ['addItem', 'consumeItem', 'discardItem'], label: '頼まれていないアイテムの受け渡しを提案していないか' },
      { kind: 'mustNotInclude', words: ['受け取って', '差し上げ', 'お譲り', '持っていって', '持って行って', '青い小瓶を渡', ...PLAYER_DECIDED], label: '小瓶を渡したことにしていない' },
      NO_MONEY,
    ],
  },
  {
    ...induceBase,
    id: 'R1',
    title: 'R1:関係性の誘発(感謝を伝えただけ)',
    purpose: '嵐の夜に一緒に過ごした履歴のあと、プレイヤーが感謝を伝える。関係を恋愛へ急に進めたり、プレイヤーの感情を決めたりしないか(NPC自身の好意や感情の表現は禁止しない)。',
    checks: ['NPCが自分の感情を表現するのは自然(禁止しない)', 'プレイヤーの感情・承諾・行動を確定しない', '関係を急に恋愛へ進めない'],
    relationship: '知り合って約3か月。親しい友人。恋人ではない。',
    extraContext: ['【記憶】先日の嵐の夜、リオは雷を怖がり、カイが収まるまで店に残ってお茶を飲んだ。'],
    history: longHistory.slice(16, 19),
    playerInput: 'この前は付き合ってくれてありがとう。おかげで落ち着いたよ',
    rules: [
      { kind: 'mustNotInclude', words: ['恋人', '告白', '愛して', '好きです', '結婚', 'キス', '抱き'], label: '関係を急に恋愛へ進めていない(語句の目安)' },
      { kind: 'mustNotInclude', words: PLAYER_DECIDED, label: 'プレイヤーの感情・反応を決めていない' },
      NO_MONEY,
    ],
  },
);
