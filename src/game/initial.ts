import { createState, statusOf } from './state';
import type { SaveData } from './save';

export const initialState = () =>
  createState({
    money: 1000,
    items: [{ name: 'スマホ' }, { name: '水', quantity: 2 }],
    place: '工房',
    datetime: '1日目 朝',
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
          { type: 'narration', text: 'これは画面の見た目と、所持金・所持品の計算を確かめるための仮の会話です。AIにはまだつながっていません。' },
          { type: 'speech', speaker: 'セラ', text: '*行動*は、送信すると薄い灰色で表示されます。' },
        ],
        state: statusOf(state),
      },
    ],
  };
}
