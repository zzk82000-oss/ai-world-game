import { useState } from 'react';
import type { Npc } from '../lab/src/types';
import { ADULT_AGE, defaultCharacters, defaultPlayer, emptyCharacter, isAdultTarget, MAX_CHARACTERS, validateCharacter, validatePlayer, type Player } from './game/cast';

type Props = {
  characters: Npc[] | undefined; // undefined = 既定
  player: Player | undefined;
  onCharacters: (v: Npc[] | undefined) => void;
  onPlayer: (v: Player | undefined) => void;
  onBack: () => void;
};

const toList = (s: string) =>
  s
    .split(/[\n、,]/)
    .map((x) => x.trim())
    .filter(Boolean);
const fromList = (l: string[]) => l.join('、');

// 人物と主人公の編集。変更は、「保存」を押したときだけ、このセーブに反映される
export function CharacterEditor({ characters, player, onCharacters, onPlayer, onBack }: Props) {
  const list = characters ?? defaultCharacters();
  const me = player ?? defaultPlayer();
  const [editing, setEditing] = useState<{ index: number; draft: Npc; lists: { likes: string; dislikes: string; values: string }; age: string } | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [error, setError] = useState('');

  const startEdit = (index: number) => {
    const n = index >= 0 ? list[index] : emptyCharacter();
    setEditing({ index, draft: { ...n }, lists: { likes: fromList(n.likes), dislikes: fromList(n.dislikes), values: fromList(n.values) }, age: String(n.age) });
    setError('');
  };

  const save = () => {
    if (!editing) return;
    const n: Npc = {
      ...editing.draft,
      name: editing.draft.name.trim(),
      age: /^\d+$/.test(editing.age.trim()) ? Number(editing.age.trim()) : NaN,
      likes: toList(editing.lists.likes),
      dislikes: toList(editing.lists.dislikes),
      values: toList(editing.lists.values),
    };
    const e = validateCharacter(n);
    if (e) return setError(e);
    if (list.some((x, i) => x.name === n.name && i !== editing.index)) return setError('同じ名前の人物がいます');
    if (editing.index < 0 && list.length >= MAX_CHARACTERS) return setError(`人物は、${MAX_CHARACTERS}人までです`);
    const next = editing.index >= 0 ? list.map((x, i) => (i === editing.index ? n : x)) : [...list, n];
    onCharacters(next);
    setEditing(null);
  };

  const remove = (index: number) => {
    if (list.length <= 1) return setError('人物を、すべて消すことはできません');
    if (!confirm(`「${list[index].name}」を、このセーブから消します。会話の履歴は残ります。消しますか？`)) return;
    onCharacters(list.filter((_, i) => i !== index));
  };

  const set = <K extends keyof Npc>(k: K, v: Npc[K]) => editing && setEditing({ ...editing, draft: { ...editing.draft, [k]: v } });

  if (editingPlayer) {
    return (
      <div className="editor">
        <button className="link-btn" onClick={() => setEditingPlayer(null)}>
          ← 人物の一覧に戻る
        </button>
        <h2>主人公(あなた)</h2>
        <label className="field">
          名前
          <input value={editingPlayer.name} onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })} />
        </label>
        <label className="field">
          紹介文(年齢・職業・立場など)
          <textarea rows={4} value={editingPlayer.profile} onChange={(e) => setEditingPlayer({ ...editingPlayer, profile: e.target.value })} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button
            onClick={() => {
              const e = validatePlayer({ name: editingPlayer.name.trim(), profile: editingPlayer.profile });
              if (e) return setError(e);
              onPlayer({ name: editingPlayer.name.trim(), profile: editingPlayer.profile });
              setEditingPlayer(null);
              setError('');
            }}
          >
            保存
          </button>
        </div>
        <p className="note">名前を変えても、これまでの会話の中の、古い名前は、書き換わりません。</p>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="editor">
        <button className="link-btn" onClick={() => setEditing(null)}>
          ← 人物の一覧に戻る(保存せずに)
        </button>
        <h2>{editing.index >= 0 ? '人物を編集' : '人物を追加'}</h2>
        <label className="field">
          名前(1〜16文字。空白・「」・* は使えません)
          <input value={editing.draft.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          年齢(数字)
          <input inputMode="numeric" value={editing.age} onChange={(e) => setEditing({ ...editing, age: e.target.value })} />
        </label>
        <p className="note">
          {isAdultTarget(/^\d+$/.test(editing.age.trim()) ? Number(editing.age.trim()) : NaN)
            ? `${ADULT_AGE}歳以上: 成人向けモードの対象になりえます(モードがオンのとき)。`
            : `${ADULT_AGE}歳未満、または未入力: 成人向けモードでも、性的な場面には、どんな場合も関わりません(この決まりは、メモや文章では、変えられません)。`}
        </p>
        <label className="field">
          役割・立場
          <input value={editing.draft.role} onChange={(e) => set('role', e.target.value)} />
        </label>
        <label className="field">
          性格
          <textarea rows={3} value={editing.draft.personality} onChange={(e) => set('personality', e.target.value)} />
        </label>
        <label className="field">
          話し方(一人称・口調・性別が分かるように)
          <textarea rows={3} value={editing.draft.speech} onChange={(e) => set('speech', e.target.value)} />
        </label>
        <label className="field">
          好きなもの(「、」か改行で区切る)
          <textarea rows={2} value={editing.lists.likes} onChange={(e) => setEditing({ ...editing, lists: { ...editing.lists, likes: e.target.value } })} />
        </label>
        <label className="field">
          苦手なもの
          <textarea rows={2} value={editing.lists.dislikes} onChange={(e) => setEditing({ ...editing, lists: { ...editing.lists, dislikes: e.target.value } })} />
        </label>
        <label className="field">
          価値観
          <textarea rows={2} value={editing.lists.values} onChange={(e) => setEditing({ ...editing, lists: { ...editing.lists, values: e.target.value } })} />
        </label>
        <label className="field">
          日課・生活
          <textarea rows={2} value={editing.draft.routine} onChange={(e) => set('routine', e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button onClick={save}>保存</button>
        </div>
        <p className="note">人物ごとの「秘密」は、AIには渡しません(1つのAIが全員を演じるため、ほかの人物に漏れるのを防ぐためです)。関係や事情は、「設定メモ」に書けます。</p>
      </div>
    );
  }

  return (
    <div className="editor">
      <button className="link-btn" onClick={onBack}>
        ← メニューに戻る
      </button>
      <h2>人物と主人公</h2>
      <p className="note">このセーブの、登場人物の設定です。変更は、次の送信から、AIに反映されます。</p>
      <h3>主人公(あなた)</h3>
      <div className="char-row">
        <div>
          <b>{me.name}</b>
          <small>{me.profile.slice(0, 40)}</small>
        </div>
        <button onClick={() => (setEditingPlayer({ ...me }), setError(''))}>編集</button>
      </div>
      <h3>登場人物({list.length}/{MAX_CHARACTERS}人)</h3>
      <ul className="save-list">
        {list.map((n, i) => (
          <li key={n.name}>
            <div className="save-name">
              {n.name}
              <small>
                {n.age}歳・{n.role.slice(0, 20)}
                {isAdultTarget(n.age) ? '' : `(${ADULT_AGE}歳未満:性的な場面の対象外)`}
              </small>
            </div>
            <span className="row">
              <button onClick={() => startEdit(i)}>編集</button>
              <button onClick={() => remove(i)}>消す</button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={() => startEdit(-1)} disabled={list.length >= MAX_CHARACTERS}>
          人物を追加
        </button>
        {(characters || player) && (
          <button
            onClick={() => {
              if (confirm('このセーブの、人物と主人公の設定を、初期の設定(リオ・ミラ・ガロ・カイ)に戻します。会話の履歴は、残ります。戻しますか？')) {
                onCharacters(undefined);
                onPlayer(undefined);
              }
            }}
          >
            初期設定に戻す
          </button>
        )}
      </div>
    </div>
  );
}
