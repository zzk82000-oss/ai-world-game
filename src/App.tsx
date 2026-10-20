import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DataEditor } from './DataEditor';
import { applyChanges, createState, type GameState } from './game/state';
import { mockReplies } from './mockReplies';
import { RichText } from './RichText';
import type { Message } from './types';
import './App.css';

const INPUT_MAX_HEIGHT_ROWS = 6;

function StatusPanel({ state }: { state: GameState }) {
  const items = state.items.map((i) => (i.quantity === undefined ? i.name : `${i.name}×${i.quantity}`));
  const facilities = state.facilities.map((f) => `${f.name}(${{ ordered: '発注中', delivered: '納品済み', installed: '設置済み' }[f.status]})`);
  return (
    <dl className="status">
      <div>
        <dt>日時</dt>
        <dd>{state.datetime}</dd>
      </div>
      <div>
        <dt>場所</dt>
        <dd>{state.place}</dd>
      </div>
      <div>
        <dt>所持金</dt>
        <dd>
          {state.money.toLocaleString('ja-JP')}
          {state.currency}
        </dd>
      </div>
      <div>
        <dt>所持品</dt>
        <dd>{items.length ? items.join('、') : 'なし'}</dd>
      </div>
      {facilities.length > 0 && (
        <div className="wide">
          <dt>設備</dt>
          <dd>{facilities.join('、')}</dd>
        </div>
      )}
    </dl>
  );
}

const initialState = createState({
  money: 1000,
  items: [{ name: 'スマホ' }, { name: '水', quantity: 2 }],
  place: '工房',
  datetime: '1日目 朝',
});

export default function App() {
  const [gameState, setGameState] = useState<GameState>(initialState);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: 'ai',
      blocks: [
        { type: 'narration', text: 'これは画面の見た目と、所持金・所持品の計算を確かめるための仮の会話です。AIにはまだつながっていません。' },
        { type: 'speech', speaker: 'セラ', text: '*行動*は、送信すると薄い灰色で表示されます。' },
      ],
      state: initialState,
    },
  ]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const nextId = useRef(1);
  const replyIndex = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 入力欄は初期2行、改行に応じて約6行まで広げ、それ以降は欄内でスクロール
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    const max = lineHeight * INPUT_MAX_HEIGHT_ROWS + 20;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [draft]);

  // 最新の返答を読んでいる間は自動で下へ追従。過去ログを読んでいる間は位置を保つ
  useEffect(() => {
    const el = logRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [messages, atBottom]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const scrollToBottom = () => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const send = () => {
    if (!draft.trim()) return;
    const reply = mockReplies[replyIndex.current % mockReplies.length];
    replyIndex.current += 1;
    const playerId = nextId.current++;
    const aiId = nextId.current++;
    // AIの変更案を検証して反映する。成立しないときは、状態を変えずに理由を表示する
    const result = applyChanges(gameState, reply.changes);
    const next = result.ok ? result.state : gameState;
    setGameState(next);
    setMessages((prev) => [
      ...prev,
      { id: playerId, role: 'player', text: draft },
      {
        id: aiId,
        role: 'ai',
        blocks: reply.blocks,
        state: next,
        notice: result.ok ? undefined : `状態の変更は反映されませんでした: ${result.error}`,
      },
    ]);
    setDraft('');
    setAtBottom(true);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>AIゲーム</h1>
        <button className="icon-btn" aria-label="メニュー" onClick={() => setMenuOpen(true)}>
          ☰
        </button>
      </header>

      <div className="log" ref={logRef} onScroll={onScroll}>
        {messages.map((m) =>
          m.role === 'player' ? (
            <div key={m.id} className="player">
              <div className="player-bubble">
                <RichText text={m.text} />
              </div>
            </div>
          ) : (
            <div key={m.id} className="ai">
              {m.blocks.map((b, i) =>
                b.type === 'narration' ? (
                  <p key={i} className="narration">
                    {b.text}
                  </p>
                ) : (
                  <div key={i} className="speech">
                    <div className="avatar" aria-hidden="true">
                      {b.speaker.slice(0, 1)}
                    </div>
                    <div className="speech-body">
                      <div className="speaker">{b.speaker}</div>
                      <div className="speech-bubble">
                        <RichText text={b.text} />
                      </div>
                    </div>
                  </div>
                ),
              )}
              {m.notice && <p className="notice">{m.notice}</p>}
              <StatusPanel state={m.state} />
            </div>
          ),
        )}
      </div>

      {!atBottom && (
        <button className="to-bottom" onClick={scrollToBottom}>
          最新へ ↓
        </button>
      )}

      <div className="composer">
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder="行動は *アスタリスク* で囲みます"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="send" onClick={send} disabled={!draft.trim()}>
          送信
        </button>
      </div>

      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`menu ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <button
          className="icon-btn close"
          aria-label="閉じる"
          onClick={() => {
            setMenuOpen(false);
            setEditing(false);
          }}
        >
          ×
        </button>
        {editing ? (
          <DataEditor state={gameState} onChange={setGameState} onBack={() => setEditing(false)} />
        ) : (
          <>
            <ul>
              <li>
                <button className="menu-item" onClick={() => setEditing(true)}>
                  ゲームデータの編集
                </button>
              </li>
              <li>NPC(仮)</li>
              <li>ログ検索(仮)</li>
              <li>セーブ(仮)</li>
              <li>設定(仮)</li>
            </ul>
            <p className="note">「(仮)」の項目は、まだ中身がありません。</p>
          </>
        )}
      </aside>
    </div>
  );
}
