import { useState } from 'react';
import { applyChange, type Change, type GameState } from './game/state';

type Props = {
  state: GameState;
  onChange: (next: GameState) => void;
  onBack: () => void;
};

// プレイヤーによる手動編集。AIの変更案と同じ検証ルールを通す
export function DataEditor({ state, onChange, onBack }: Props) {
  const [error, setError] = useState('');
  const [money, setMoney] = useState(String(state.money));
  const [place, setPlace] = useState(state.place);
  const [datetime, setDatetime] = useState(state.datetime);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');

  const apply = (change: Change) => {
    const r = applyChange(state, change);
    if (r.ok) {
      setError('');
      onChange(r.state);
    } else {
      setError(r.error);
    }
    return r.ok;
  };

  const parseQty = (s: string) => (s.trim() === '' ? undefined : Number(s));

  return (
    <div className="editor">
      <button className="link-btn" onClick={onBack}>
        ← メニューに戻る
      </button>
      <h2>ゲームデータの編集</h2>

      <label className="field">
        日時
        <div className="row">
          <input value={datetime} maxLength={40} onChange={(e) => setDatetime(e.target.value)} />
          <button onClick={() => apply({ type: 'setDatetime', datetime })}>変更</button>
        </div>
      </label>
      <label className="field">
        場所
        <div className="row">
          <input value={place} onChange={(e) => setPlace(e.target.value)} />
          <button onClick={() => apply({ type: 'setPlace', place })}>変更</button>
        </div>
      </label>

      <label className="field">
        所持金({state.currency})
        <div className="row">
          <input type="number" inputMode="numeric" value={money} onChange={(e) => setMoney(e.target.value)} />
          <button onClick={() => apply({ type: 'setMoney', amount: Number(money) })}>変更</button>
        </div>
      </label>

      <h3>所持品</h3>
      {state.items.length === 0 && <p className="note">なし</p>}
      <ul className="item-list">
        {state.items.map((i) => (
          <li key={i.name}>
            <span className="item-name">{i.name}</span>
            <input
              type="number"
              inputMode="numeric"
              aria-label={`${i.name}の数量`}
              defaultValue={i.quantity ?? ''}
              placeholder="数なし"
              onBlur={(e) => {
                const q = parseQty(e.target.value);
                if (q !== i.quantity) apply({ type: 'setItemQuantity', name: i.name, quantity: q });
              }}
            />
            <button onClick={() => apply({ type: 'discardItem', name: i.name })}>削除</button>
          </li>
        ))}
      </ul>

      <div className="row">
        <input placeholder="物の名前" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input
          type="number"
          inputMode="numeric"
          placeholder="数(任意)"
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
        />
        <button
          onClick={() => {
            if (apply({ type: 'addItem', name: newName, quantity: parseQty(newQty) })) {
              setNewName('');
              setNewQty('');
            }
          }}
        >
          追加
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
