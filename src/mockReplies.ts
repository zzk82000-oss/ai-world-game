import type { Change } from './game/state';
import type { Block } from './types';

// 仮の返答。AI接続の前に、見た目とゲーム状態の更新を確かめるためのもの。
// changes は「AIが返す状態変更案」の代わり。実際の計算・確定は game/state.ts が行う
export type MockReply = { blocks: Block[]; changes: Change[] };

export const mockReplies: MockReply[] = [
  {
    blocks: [
      { type: 'narration', text: '窓から差し込む朝の光が、工房の床に四角い影を落としている。' },
      { type: 'speech', speaker: 'セラ', text: 'おはようございます。今日は何から始めましょうか。' },
    ],
    changes: [],
  },
  {
    blocks: [
      { type: 'speech', speaker: 'ガロ', text: 'おう、来たか。ちょうどいいものが入ったところだ。500Gでどうだ。' },
      { type: 'narration', text: 'ガロは棚の奥から、布に包まれた細長い箱を取り出した。あなたは代金を払い、箱を受け取った。' },
      { type: 'speech', speaker: 'セラ', text: '……また高そうなものを。' },
    ],
    changes: [{ type: 'purchase', itemName: '細長い箱', price: 500 }],
  },
  {
    blocks: [
      { type: 'narration', text: '店の外で、雨が屋根を叩く音が強くなってきた。ガロが温かいお茶を出してくれた(100G)。' },
      { type: 'speech', speaker: 'セラ', text: '少し、雨宿りしていきませんか。' },
    ],
    changes: [{ type: 'pay', amount: 100, reason: 'お茶代' }],
  },
];
