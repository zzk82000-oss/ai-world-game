import { createState, statusOf } from './state';
import type { SaveData } from './save';

// 新しいセーブの初期状態。舞台は港町ルセナ(世界・人物は lab/src/data/fixture.ts と共通)
export const initialState = () =>
  createState({
    money: 3000,
    items: [{ name: '財布' }, { name: '工房の鍵' }],
    place: '港町ルセナ・工房通り',
    datetime: '春 1週目 月曜 朝',
  });

export function createInitialSave(id: string, now: number, name = 'はじめのセーブ'): SaveData {
  const state = initialState();
  return {
    format: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    state,
    messages: [
      {
        id: 0,
        role: 'ai',
        blocks: [
          { type: 'narration', text: '春の朝、港町ルセナ。潮の匂いが混じる工房通りに、開いたばかりの魔道具の工房がある。向かいの通りには、薬屋の看板が見える。' },
          { type: 'narration', text: '*行動*は、アスタリスクで囲んで送ってください。' },
        ],
        state: statusOf(state),
      },
    ],
  };
}
