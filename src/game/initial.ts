import { createState, statusOf } from './state';
import type { SaveData } from './save';
import { emptyCharacter } from './cast';

// 新しいセーブの初期状態。舞台は港町ルセナ(世界・人物は lab/src/data/fixture.ts と共通)
export const initialState = () =>
  createState({
    money: 3000,
    items: [{ name: '財布' }, { name: '工房の鍵' }],
    place: '港町ルセナ・工房通り',
    datetime: '春 1週目 月曜 朝',
  });

export const blankState = () => createState({ money: 3000, items: [{ name: '財布' }], place: '(設定メモの場所)', datetime: '(設定メモの時期)' });

export function createInitialSave(id: string, now: number, name = 'はじめのセーブ', blank = false): SaveData {
  const state = blank ? blankState() : initialState();
  return {
    format: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    state,
    ...(blank ? { blank: true, characters: [{ ...emptyCharacter(), name: '人物1', role: '(未設定。「人物と主人公」で編集してください)' }], player: { name: '主人公', profile: '(未設定)' } } : {}),
    messages: [
      {
        id: 0,
        role: 'ai',
        blocks: blank
          ? [
              { type: 'narration', text: '設定メモに書いた世界の、はじまりの場面です。最初の行動やセリフを送ってください。' },
              { type: 'narration', text: '*行動*は、アスタリスクで囲んで送ってください。' },
            ]
          : [
          { type: 'narration', text: '春の朝、港町ルセナ。潮の匂いが混じる工房通りに、開いたばかりの魔道具の工房がある。向かいの通りには、薬屋の看板が見える。' },
          { type: 'narration', text: '*行動*は、アスタリスクで囲んで送ってください。' },
        ],
        state: statusOf(state),
      },
    ],
  };
}
