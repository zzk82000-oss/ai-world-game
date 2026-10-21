import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialSave, initialState } from './game/initial';
import { importAsNew, newId, parseBackup, serializeBackup, SAVE_FORMAT, type SaveData } from './game/save';
import type { GameState } from './game/state';
import { SaveStore } from './game/storage';
import type { Message } from './types';

export type SaveStatus = 'saved' | 'saving' | 'error' | 'unavailable';
type Meta = { id: string; name: string; createdAt: number };
export type SaveSummary = { id: string; name: string; updatedAt: number };

const DEBOUNCE_MS = 300;

// セーブの読み込み・自動保存・切り替え・バックアップをまとめて扱う。
// ready になるまで(読み込みが完了するまで)は、保存データに一切書き込まない。
export function useGameSave() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [notice, setNotice] = useState('');
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [activeId, setActiveId] = useState('');
  const [gameState, setGameState] = useState<GameState>(initialState);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [setup, setSetup] = useState('');

  const storeRef = useRef<SaveStore | null>(null);
  const metaRef = useRef<Meta>({ id: '', name: '', createdAt: 0 });
  const lastSaved = useRef<{ state: GameState; messages: Message[]; draft: string; setup: string } | null>(null);
  const latest = useRef({ gameState, messages, draft, setup });
  latest.current = { gameState, messages, draft, setup };
  const chain = useRef<Promise<void>>(Promise.resolve());

  const adopt = useCallback((save: SaveData, draftText: string) => {
    metaRef.current = { id: save.id, name: save.name, createdAt: save.createdAt };
    lastSaved.current = { state: save.state, messages: save.messages, draft: draftText, setup: save.setup ?? '' };
    setSetup(save.setup ?? '');
    setGameState(save.state);
    setMessages(save.messages);
    setDraft(draftText);
    setActiveId(save.id);
  }, []);

  const refreshList = useCallback(async () => {
    if (storeRef.current) setSaves(await storeRef.current.listSaves());
  }, []);

  // 起動時の読み込み
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let store: SaveStore;
      try {
        store = await SaveStore.open();
      } catch {
        if (cancelled) return;
        const s = createInitialSave(newId(), Date.now());
        adopt(s, '');
        setStatus('unavailable');
        setNotice('この端末のブラウザでは保存できません。ページを閉じると、内容は消えます。');
        setReady(true);
        return;
      }
      try {
        let id = await store.getActiveId();
        if (!id) id = (await store.listSaves())[0]?.id;
        let result = id ? await store.load(id) : ({ kind: 'missing' } as const);
        let draftText = '';
        let save: SaveData | undefined;
        if (result.kind === 'ok' || result.kind === 'recovered') {
          save = result.save;
          draftText = await store.getDraft(save.id);
          if (result.kind === 'recovered') {
            const min = Math.max(1, Math.round((Date.now() - result.from) / 60000));
            setNotice(`保存データが壊れていたため、約${min}分以上前の状態から復元しました。壊れたデータは退避して残してあります。`);
          }
        } else {
          if (result.kind === 'lost') {
            setNotice(`保存データが壊れていて復元できませんでした(${result.error})。壊れたデータは退避して残し、新しいセーブを作りました。`);
          }
          save = createInitialSave(newId(), Date.now());
          await store.put(save);
        }
        await store.setActiveId(save.id);
        if (cancelled) return;
        storeRef.current = store;
        adopt(save, draftText);
        await refreshList();
        setReady(true);
      } catch {
        if (cancelled) return;
        const s = createInitialSave(newId(), Date.now());
        adopt(s, '');
        setStatus('unavailable');
        setNotice('保存データの読み込みに失敗しました。念のため、保存はせずに起動しています。ページを更新してやり直してください。');
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, refreshList]);

  // 保存の実行。順番を守るため、前の保存が終わってから次を行う
  const writeNow = useCallback(() => {
    const store = storeRef.current;
    if (!store || !lastSaved.current) return chain.current;
    const cur = latest.current;
    const prev = lastSaved.current;
    const stateChanged = cur.gameState !== prev.state || cur.messages !== prev.messages || cur.setup !== prev.setup;
    const draftChanged = cur.draft !== prev.draft;
    if (!stateChanged && !draftChanged) return chain.current;
    lastSaved.current = { state: cur.gameState, messages: cur.messages, draft: cur.draft, setup: cur.setup };
    const meta = metaRef.current;
    setStatus('saving');
    chain.current = chain.current
      .then(async () => {
        if (stateChanged) {
          await store.put({
            format: SAVE_FORMAT,
            id: meta.id,
            name: meta.name,
            createdAt: meta.createdAt,
            updatedAt: Date.now(),
            state: cur.gameState,
            messages: cur.messages,
            ...(cur.setup ? { setup: cur.setup } : {}),
          });
        }
        if (draftChanged) await store.putDraft(meta.id, cur.draft);
        setStatus('saved');
      })
      .catch(() => {
        lastSaved.current = prev; // 失敗したので、次の機会にもう一度保存する
        setStatus('error');
      });
    return chain.current;
  }, []);

  // 変更のたびに、少し待ってから自動保存
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void writeNow(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, gameState, messages, draft, setup, writeNow]);

  // 画面を閉じる・別アプリに移るときは、待たずに保存する
  useEffect(() => {
    const flush = () => void writeNow();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [writeNow]);

  const switchTo = useCallback(
    async (id: string) => {
      const store = storeRef.current;
      if (!store || id === metaRef.current.id) return { ok: true as const };
      await writeNow();
      const r = await store.load(id);
      if (r.kind !== 'ok' && r.kind !== 'recovered') return { ok: false as const, error: 'このセーブを開けませんでした' };
      const draftText = await store.getDraft(id);
      await store.setActiveId(id);
      adopt(r.save, draftText);
      await refreshList();
      return { ok: true as const };
    },
    [adopt, refreshList, writeNow],
  );

  // 新しいセーブで、はじめから始める。今のセーブは消さずに残す
  const createNew = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return { ok: false as const, error: '保存できない状態のため、新しく始められません' };
    await writeNow();
    const names = (await store.listSaves()).map((x) => x.name);
    let name = '新しいセーブ';
    for (let n = 2; names.includes(name); n++) name = `新しいセーブ${n}`;
    const save = createInitialSave(newId(), Date.now(), name);
    await store.put(save);
    await store.setActiveId(save.id);
    adopt(save, '');
    await refreshList();
    return { ok: true as const, name };
  }, [adopt, refreshList, writeNow]);

  const exportBackup = useCallback(() => {
    const cur = latest.current;
    const meta = metaRef.current;
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const text = serializeBackup(
      {
        format: SAVE_FORMAT,
        id: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: now.getTime(),
        state: cur.gameState,
        messages: cur.messages,
        ...(cur.setup ? { setup: cur.setup } : {}),
      },
      now.getTime(),
    );
    return { filename: `ai-game-backup-${stamp}.json`, text };
  }, []);

  const importBackup = useCallback(
    async (text: string) => {
      const store = storeRef.current;
      if (!store) return { ok: false as const, error: '保存できない状態のため、読み込めません' };
      const parsed = parseBackup(text);
      if (!parsed.ok) return parsed;
      const names = (await store.listSaves()).map((s) => s.name);
      const imported = importAsNew(parsed.save, names, Date.now());
      await store.put(imported);
      await refreshList();
      return { ok: true as const, name: imported.name };
    },
    [refreshList],
  );

  return {
    ready, status, notice, setNotice, saves, activeId,
    gameState, setGameState, messages, setMessages, draft, setDraft, setup, setSetup,
    switchTo, createNew, exportBackup, importBackup,
  };
}
