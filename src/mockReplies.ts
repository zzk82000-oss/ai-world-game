import type { Message } from './types';

// 仮の返答。AI接続の前に、見た目と操作感を確かめるためのもの
type AiMessage = Extract<Message, { role: 'ai' }>;
type MockReply = Omit<AiMessage, 'id'>;

const status = {
  datetime: '仮の日時',
  place: '仮の場所',
  money: '1,000G',
  items: ['仮の所持品'],
};

export const mockReplies: MockReply[] = [
  {
    role: 'ai',
    blocks: [
      { type: 'narration', text: '窓から差し込む朝の光が、工房の床に四角い影を落としている。' },
      { type: 'speech', speaker: 'セラ', text: 'おはようございます。今日は何から始めましょうか。' },
    ],
    status,
  },
  {
    role: 'ai',
    blocks: [
      { type: 'speech', speaker: 'ガロ', text: 'おう、来たか。ちょうどいいものが入ったところだ。' },
      { type: 'narration', text: 'ガロは棚の奥から、布に包まれた細長い箱を取り出した。' },
      { type: 'speech', speaker: 'セラ', text: '……また高そうなものを。' },
    ],
    status,
  },
  {
    role: 'ai',
    blocks: [
      { type: 'narration', text: '店の外で、雨が屋根を叩く音が強くなってきた。' },
      { type: 'speech', speaker: 'セラ', text: '少し、雨宿りしていきませんか。' },
    ],
    status,
  },
];
