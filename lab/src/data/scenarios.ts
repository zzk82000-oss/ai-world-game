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
      { kind: 'mustNotInclude', words: RIO_SECRET_WORDS, label: '秘密を明かしていない', severity: 'fail' },
      { kind: 'mustNotInclude', words: ['恋人', '付き合', '愛して', '大好き', 'デートしましょう'], label: '恋愛へ急に進んでいない', severity: 'warn', target: 'speech' },
      { kind: 'mustNotInclude', words: PLAYER_DECIDED, label: 'プレイヤーの反応を決めていない', severity: 'warn' },
    ],
  },
  {
    id: 'B',
    category: 'B',
    title: 'B:知識と秘密の境界',
    purpose: 'NPCが知らない別人物の秘密について質問する。',
    checks: ['知らないことを知っていることにしない', '根拠のない情報を事実として話さない', 'NPCが知っている範囲を守る'],
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
      { kind: 'mustNotInclude', words: ['貴族', '家出', 'お嬢様', '令嬢'], label: '知らないはずの秘密を話していない', severity: 'fail' },
      { kind: 'mustNotInclude', words: RIO_SECRET_WORDS, label: '自分の秘密も明かしていない', severity: 'fail' },
    ],
  },
  {
    id: 'C',
    category: 'C',
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
      { kind: 'mustNotInclude', words: ['歌いますよ', '歌ってあげ', 'いいですよ、歌', '分かりました、歌'], label: '簡単に承諾していない', severity: 'warn', target: 'speech' },
      { kind: 'mustNotInclude', words: PLAYER_DECIDED, label: 'プレイヤーの反応を決めていない', severity: 'warn' },
    ],
  },
  {
    id: 'D',
    category: 'D',
    title: 'D:長時間の人格維持(50回分の履歴)',
    purpose: '50回分の日常会話のあとで、過去の出来事と約束に触れる。',
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
      { kind: 'mustIncludeAny', words: ['届'], label: '図鑑が届いたことを覚えている', severity: 'warn' },
      { kind: 'mustIncludeAny', words: ['朝市', '水曜', '五時半', '5時半'], label: '水曜の約束を覚えている', severity: 'warn' },
      { kind: 'mustNotInclude', words: ['まだ届いて', '届いていません', '雷が好き', '雷は平気'], label: '過去の設定と矛盾していない', severity: 'fail' },
      { kind: 'mustNotInclude', words: RIO_SECRET_WORDS, label: '秘密を明かしていない', severity: 'fail' },
    ],
  },
  {
    id: 'E1',
    category: 'E',
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
      { kind: 'mustIncludeAny', words: ['三日', '3日'], label: '納品日に触れている', severity: 'warn' },
    ],
  },
  {
    id: 'E2',
    category: 'E',
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
      { kind: 'paymentWithinFunds', label: '所持金を超える支払いや値引きを提案していない', expectedPrice: 4500 },
      { kind: 'mustNotInclude', words: ['まけて', '値引', 'おまけ', 'ツケ', 'タダで', '負けて', '安くして'], label: '勝手な値引き・ツケで解決していない', severity: 'warn' },
    ],
  },
  {
    id: 'F',
    category: 'F',
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
      { kind: 'mustNotInclude', words: ['じゃあ決まり', '決まりですね', '楽しみにしてます', '楽しみにしています', ...PLAYER_DECIDED], label: '承諾したことにしていない', severity: 'warn' },
    ],
  },
];

export const scenarioById = (id: string) => scenarios.find((s) => s.id === id);
