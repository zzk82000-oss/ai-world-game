import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mockReplies } from './mockReplies';
import { RichText } from './RichText';
import type { Message, Status } from './types';
import './App.css';

const INPUT_MAX_HEIGHT_ROWS = 6;

function StatusPanel({ status }: { status: Status }) {
  return (
    <dl className="status">
      <div>
        <dt>日時</dt>
        <dd>{status.datetime}</dd>
      </div>
      <div>
        <dt>場所</dt>
        <dd>{status.place}</dd>
      </div>
      <div>
        <dt>所持金</dt>
        <dd>{status.money}</dd>
      </div>
      <div>
        <dt>所持品</dt>
        <dd>{status.items.join('、')}</dd>
      </div>
    </dl>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: 'ai',
      blocks: [
        { type: 'narration', text: 'これは画面の見た目を確かめるための仮の会話です。AIにはまだつながっていません。' },
        { type: 'speech', speaker: 'セラ', text: '*行動*は、送信すると薄い灰色で表示されます。' },
      ],
      status: { datetime: '仮の日時', place: '仮の場所', money: '1,000G', items: ['仮の所持品'] },
    },
  ]);
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
    setMessages((prev) => [
      ...prev,
      { id: playerId, role: 'player', text: draft },
      { ...reply, id: aiId },
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
              <StatusPanel status={m.status} />
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
        <button className="icon-btn close" aria-label="閉じる" onClick={() => setMenuOpen(false)}>
          ×
        </button>
        <ul>
          <li>NPC</li>
          <li>所持品・施設</li>
          <li>ログ検索</li>
          <li>セーブ</li>
          <li>設定</li>
        </ul>
        <p className="note">メニューの中身は仮です。</p>
      </aside>
    </div>
  );
}
