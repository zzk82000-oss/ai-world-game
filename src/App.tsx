import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DataEditor } from './DataEditor';
import { AiSettings, GAME_MODELS } from './AiSettings';
import { playTurn, settleChanges } from './ai/turn';
import { browserKV, DAILY_LIMIT, readUsage, tryCount } from './ai/usage';
import { useVault } from './ai/useVault';
import type { ReplyLength } from './ai/narrator';
import { statusOf, type StatusSnapshot } from './game/state';
import { modelByKey } from '../lab/src/models';
import { validProviderSlug } from '../lab/src/providers';
import type { ModelInfo } from '../lab/src/types';
import { RichText } from './RichText';
import { SaveManager } from './SaveManager';
import { SetupEditor } from './SetupEditor';
import { useGameSave } from './useGameSave';
import './App.css';

const INPUT_MAX_HEIGHT_ROWS = 6;

function StatusPanel({ state }: { state: StatusSnapshot }) {
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

export default function App() {
  const {
    ready, status, notice, setNotice, saves, activeId,
    gameState, setGameState, messages, setMessages, draft, setDraft, setup, setSetup,
    switchTo, createNew, deleteSaves, exportBackup, importBackup,
  } = useGameSave();
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const kvRef = useRef(browserKV());
  const [usage, setUsage] = useState(() => ({ count: readUsage(kvRef.current, Date.now()).count, limit: DAILY_LIMIT }));
  const [modelKey, setModelKeyState] = useState(() => {
    try {
      const v = localStorage.getItem('ai-game-model');
      return GAME_MODELS.some((m) => m.key === v) ? (v as string) : GAME_MODELS[0].key;
    } catch {
      return GAME_MODELS[0].key;
    }
  });
  const store = (key: string, v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* 保存できなくても動く */
    }
  };
  const [adult, setAdultState] = useState(() => {
    try {
      return localStorage.getItem('ai-game-adult') === '1';
    } catch {
      return false;
    }
  });
  const setAdult = (on: boolean) => {
    setAdultState(on);
    store('ai-game-adult', on ? '1' : '0');
  };
  const [replyLength, setReplyLengthState] = useState<ReplyLength>(() => {
    try {
      return localStorage.getItem('ai-game-length') === 'normal' ? 'normal' : 'compact';
    } catch {
      return 'compact';
    }
  });
  const setReplyLength = (v: ReplyLength) => {
    setReplyLengthState(v);
    store('ai-game-length', v);
  };
  const [veniceModelId, setVeniceIdState] = useState(() => {
    try {
      return localStorage.getItem('ai-game-venice-model') ?? '';
    } catch {
      return '';
    }
  });
  const setVeniceModelId = (v: string) => {
    setVeniceIdState(v);
    store('ai-game-venice-model', v);
  };
  // 選んだモデルの情報。「IDで指定」のときは、Venice 用のモデルを土台に、IDだけを差し替える(料金は不明なので、費用は計算しない)
  const resolveModel = (): ModelInfo | undefined => {
    if (modelKey !== 'venice-custom') return modelByKey(modelKey);
    const id = veniceModelId.trim();
    const base = modelByKey('venice-uncensored-1-2');
    if (!base || !id || !validProviderSlug(id)) return undefined;
    return { ...base, key: 'venice-custom', displayName: `Venice: ${id}`, apiModelId: id, priceInputUsdPerM: undefined, priceOutputUsdPerM: undefined };
  };
  const [providerPin, setPinState] = useState(() => {
    try {
      return localStorage.getItem('ai-game-provider-pin') ?? '';
    } catch {
      return '';
    }
  });
  const setProviderPin = (v: string) => {
    setPinState(v);
    store('ai-game-provider-pin', v);
  };
  const setModelKey = (k: string) => {
    setModelKeyState(k);
    try {
      localStorage.setItem('ai-game-model', k);
    } catch {
      /* 保存できなくても動く */
    }
  };
  // 非同期の処理の後でも、最新の状態・会話を使うための参照
  const live = useRef({ gameState, messages });
  live.current = { gameState, messages };
  const [view, setView] = useState<'main' | 'editor' | 'saves' | 'ai' | 'setup'>('main');
  const [menuOpen, setMenuOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
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

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const model = resolveModel();
    const ep = modelKey.startsWith('venice') ? 'venice' : 'openrouter';
    const key = vault.getKey(ep);
    if (modelKey === 'venice-custom' && !model) {
      setNotice('Venice のモデルIDが、未入力か、形式が正しくありません(「AIの設定」で入力してください)。');
      return;
    }
    if (!key || !model) {
      setNotice(`${ep === 'venice' ? 'Venice' : 'OpenRouter'} につながっていません。メニューの「AIの設定」で、キーの保存または解錠をしてください。`);
      return;
    }
    // 1日の呼び出し回数の上限。数えるのは送信しようとした回数
    const counted = tryCount(kvRef.current, Date.now());
    setUsage({ count: counted.count, limit: counted.limit });
    if (!counted.ok) {
      setNotice(`今日のAI呼び出しの上限(${counted.limit}回)に達しました。日付が変わると、また使えます。`);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setAtBottom(true);
    const result = await playTurn({ model, apiKey: key, state: live.current.gameState, messages: live.current.messages, playerText: text, signal: ac.signal, adult, providerPin, setup, length: replyLength });
    abortRef.current = null;
    setBusy(false);
    if (!result.ok) {
      // 失敗・停止のときは、会話も状態も変えず、入力はそのまま残す(もう一度送れる)
      setNotice(result.aborted ? '停止しました。入力は残してあります。' : `AIの返答を受け取れませんでした: ${result.error}(入力は残してあります)`);
      return;
    }
    // 反映は、待っている間に手動編集があっても壊さないよう、最新の状態に対して検証する
    const settled = settleChanges(live.current.gameState, result.changes);
    setGameState(settled.state);
    setMessages((prev) => {
      const playerId = Math.max(0, ...prev.map((m) => m.id)) + 1;
      return [
        ...prev,
        { id: playerId, role: 'player', text },
        {
          id: playerId + 1,
          role: 'ai',
          blocks: result.blocks,
          state: statusOf(settled.state),
          notice: settled.notice ?? result.notice,
          applied: settled.applied ?? undefined,
        },
      ];
    });
    setDraft('');
  };

  const undo = (id: number) => {
    const m = live.current.messages.find((x) => x.id === id);
    if (!m || m.role !== 'ai' || !m.applied || m.applied.undone) return;
    setGameState(m.applied.before);
    setMessages((prev) =>
      prev.map((x) =>
        x.id === id && x.role === 'ai' && x.applied
          ? { ...x, state: statusOf(m.applied!.before), applied: { ...x.applied, undone: true }, notice: '変更を取り消しました(所持金・所持品を元に戻しました)。' }
          : x,
      ),
    );
  };

  const chosenEp = modelKey.startsWith('venice') ? 'venice' : 'openrouter';
  const connected = vault.statuses[chosenEp] === 'unlocked';
  const lastAiId = [...messages].reverse().find((m) => m.role === 'ai')?.id;

  const closeMenu = () => {
    setMenuOpen(false);
    setView('main');
  };

  if (!ready) {
    return (
      <div className="app">
        <p className="loading">読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>
          AIゲーム{adult && <small className="adult-badge"> 成人向け</small>} <small className={`save-status ${status}`}>{{ saved: '保存済み', saving: '保存中…', error: '保存できません', unavailable: '保存なし' }[status]}</small>
        </h1>
        <button className="icon-btn" aria-label="メニュー" onClick={() => setMenuOpen(true)}>
          ☰
        </button>
      </header>

      {notice && (
        <p className="notice banner" onClick={() => setNotice('')}>
          {notice}(タップで閉じる)
        </p>
      )}

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
              {m.applied && !m.applied.undone && (
                <div className="changelog">
                  <b>状態の変更</b>:{m.applied.labels.join(' / ')}
                  {m.id === lastAiId && (
                    <button className="link-btn" onClick={() => undo(m.id)}>
                      取り消す
                    </button>
                  )}
                </div>
              )}
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

      {!connected && !Object.values(vault.statuses).includes('loading') && (
        <p className="notice banner" onClick={() => { setMenuOpen(true); setView('ai'); }}>
          選んだモデルにつながっていません。タップして、キーの保存または解錠をしてください。
        </p>
      )}
      {busy && <p className="thinking">考え中…(長いときは「停止」を押せます)</p>}
      <div className="composer">
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder="行動は *アスタリスク* で囲みます"
          onChange={(e) => setDraft(e.target.value)}
        />
        {busy ? (
          <button className="send" onClick={() => abortRef.current?.abort()}>
            停止
          </button>
        ) : (
          <button className="send" onClick={() => void send()} disabled={!draft.trim() || !connected}>
            送信
          </button>
        )}
      </div>

      {menuOpen && <div className="backdrop" onClick={closeMenu} />}
      <aside className={`menu ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <button className="icon-btn close" aria-label="閉じる" onClick={closeMenu}>
          ×
        </button>
        {view === 'editor' ? (
          <DataEditor state={gameState} onChange={setGameState} onBack={() => setView('main')} />
        ) : view === 'setup' ? (
          <SetupEditor value={setup} onChange={setSetup} onBack={() => setView('main')} />
        ) : view === 'ai' ? (
          <AiSettings
            statuses={vault.statuses}
            onRegister={vault.register}
            onUnlock={vault.unlock}
            onLock={vault.lock}
            onForget={vault.forget}
            modelKey={modelKey}
            onModel={setModelKey}
            usage={usage}
            adult={adult}
            onAdult={setAdult}
            providerPin={providerPin}
            replyLength={replyLength}
            onReplyLength={setReplyLength}
            veniceModelId={veniceModelId}
            onVeniceModelId={setVeniceModelId}
            onProviderPin={setProviderPin}
            onBack={() => setView('main')}
          />
        ) : view === 'saves' ? (
          <SaveManager
            saves={saves}
            activeId={activeId}
            onOpen={async (id) => {
              const r = await switchTo(id);
              if (r.ok) closeMenu();
              return r;
            }}
            onDelete={deleteSaves}
            onNew={createNew}
            onExport={exportBackup}
            onImport={importBackup}
            onBack={() => setView('main')}
          />
        ) : (
          <>
            <ul>
              <li>
                <button className="menu-item" onClick={() => setView('editor')}>
                  ゲームデータの編集
                </button>
              </li>
              <li>
                <button className="menu-item" onClick={() => setView('setup')}>
                  設定メモ(関係・状況)
                </button>
              </li>
              <li>
                <button className="menu-item" onClick={() => setView('ai')}>
                  AIの設定
                </button>
              </li>
              <li>
                <button className="menu-item" onClick={() => setView('saves')}>
                  セーブとバックアップ
                </button>
              </li>
              <li>NPC(仮)</li>
              <li>ログ検索(仮)</li>
              
            </ul>
            <p className="note">「(仮)」の項目は、まだ中身がありません。</p>
          </>
        )}
      </aside>
    </div>
  );
}
