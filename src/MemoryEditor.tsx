import { useState } from 'react';
import { emptyMemory, MEMORY_COUNT_MAX, MEMORY_ITEM_MAX, MEMORY_KINDS, MEMORY_TOTAL_MAX, type Memory, type MemoryItem, type MemoryKind } from './game/memory';
import { newId } from './game/save';

type Props = {
  memory: Memory | undefined;
  pending: number; // まだ要約していない、要約の対象の会話の数
  connected: boolean;
  busy: boolean;
  usage: { count: number; limit: number };
  onChange: (m: Memory | undefined) => void;
  onUpdate: () => Promise<{ ok: boolean; message: string }>;
  onBack: () => void;
};

const toNames = (s: string) =>
  s
    .split(/[、,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);

// 長期記憶の閲覧・編集。記憶の更新(要約)は、このボタンを押したときだけ、1回送る
export function MemoryEditor({ memory, pending, connected, busy, usage, onChange, onUpdate, onBack }: Props) {
  const mem = memory ?? emptyMemory();
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const [adding, setAdding] = useState<{ kind: MemoryKind; text: string; who: string } | null>(null);
  const total = mem.items.reduce((a, i) => a + i.text.length, 0);

  const patch = (id: string, p: Partial<MemoryItem>) =>
    onChange({ ...mem, items: mem.items.map((i) => (i.id === id ? { ...i, ...p, source: 'player' } : i)) });

  const update = async () => {
    setMsg('');
    const r = await onUpdate();
    setIsError(!r.ok);
    setMsg(r.message);
  };

  return (
    <div className="editor">
      <button className="link-btn" onClick={onBack}>
        ← メニューに戻る
      </button>
      <h2>記憶</h2>
      <p className="note">
        古い会話から、出来事・約束・関係の転機・特定の人物だけが知っていることを、短い事実として残し、AIに渡します(直近の会話は、原文のまま渡します)。
        人物の性格・口調・所持金・場所は、ここには入れません。内容は、自由に直せます。
      </p>

      <div className="row">
        <button onClick={() => void update()} disabled={busy || !connected || pending <= 0}>
          {busy ? '更新中…' : '記憶を更新する'}
        </button>
      </div>
      <p className="note">
        要約の対象の会話: {pending}件(まだ要約していないもの)。押したときだけ、AIに1回送ります(費用は、1回あたり1円未満の見込み・今日の呼び出し回数 {usage.count}/{usage.limit} に含まれます)。
        {!connected && ' ※いま選んでいるモデルに、つながっていません(AIの設定で、キーを解錠してください)。'}
      </p>
      {msg && <p className={isError ? 'error' : 'note'}>{msg}</p>}

      <h3>
        記憶の項目({mem.items.length}/{MEMORY_COUNT_MAX}件・{total}/{MEMORY_TOTAL_MAX}文字)
      </h3>
      {mem.items.length === 0 && <p className="note">まだ、記憶はありません。会話が、直近分より長くなると、更新できます。自分で追加することも、できます。</p>}
      <ul className="memory-list">
        {mem.items.map((i) => (
          <li key={i.id}>
            <div className="row">
              <select value={i.kind} onChange={(e) => patch(i.id, { kind: e.target.value as MemoryKind })}>
                {MEMORY_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
              {i.kind === 'promise' && (
                <label className="check">
                  <input type="checkbox" checked={!!i.done} onChange={(e) => patch(i.id, { done: e.target.checked })} />
                  果たし済み
                </label>
              )}
              <button
                onClick={() => {
                  if (confirm('この記憶を消します。消しますか？')) onChange({ ...mem, items: mem.items.filter((x) => x.id !== i.id) });
                }}
              >
                消す
              </button>
            </div>
            <textarea rows={2} maxLength={MEMORY_ITEM_MAX} value={i.text} onChange={(e) => patch(i.id, { text: e.target.value })} />
            <label className="field">
              知っている人(「、」で区切る。空欄 = 指定なし)
              <input value={i.knownBy.join('、')} onChange={(e) => patch(i.id, { knownBy: toNames(e.target.value) })} />
            </label>
            <small className="note">{i.source === 'ai' ? '要約で作られた項目' : '自分で書いた・直した項目(要約では、整理されません)'}</small>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="memory-add">
          <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as MemoryKind })}>
            {MEMORY_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <textarea rows={2} maxLength={MEMORY_ITEM_MAX} placeholder="短い1文で(例: 三日後の夕方に、工房で会う約束をした)" value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} />
          <input placeholder="知っている人(任意・「、」で区切る)" value={adding.who} onChange={(e) => setAdding({ ...adding, who: e.target.value })} />
          <div className="row">
            <button
              disabled={!adding.text.trim() || mem.items.length >= MEMORY_COUNT_MAX}
              onClick={() => {
                onChange({ ...mem, items: [...mem.items, { id: newId(), kind: adding.kind, text: adding.text.trim(), knownBy: toNames(adding.who), ...(adding.kind === 'promise' ? { done: false } : {}), source: 'player' }] });
                setAdding(null);
              }}
            >
              追加
            </button>
            <button onClick={() => setAdding(null)}>やめる</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button onClick={() => setAdding({ kind: 'event', text: '', who: '' })} disabled={mem.items.length >= MEMORY_COUNT_MAX}>
            記憶を追加する
          </button>
          {mem.items.length > 0 && (
            <button
              onClick={() => {
                if (confirm('記憶を、すべて消します(要約の進み具合も、最初に戻ります)。消しますか？')) onChange(undefined);
              }}
            >
              すべて消す
            </button>
          )}
        </div>
      )}
      <p className="note">記憶は、セーブとバックアップに含まれます(GitHubなどに載せないでください)。</p>
    </div>
  );
}
