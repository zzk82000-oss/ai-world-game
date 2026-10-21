// 端末内(ブラウザの IndexedDB)への保存。データ本体はこの端末の中だけに置く。
// 会話と状態は1つのセーブとして1回の書き込みで確定する(片方だけ新しくならない)。
import { validateSave, type SaveData } from './save';

const DB_NAME = 'ai-world-game';
const SNAPSHOT_KEEP = 3; // 復旧用に残す世代数
const SNAPSHOT_MIN_INTERVAL = 10 * 60 * 1000; // 復旧用の控えを取る最短間隔

type Snapshot = { seq?: number; saveId: string; savedAt: number; data: unknown };

export type LoadResult =
  | { kind: 'ok'; save: SaveData }
  | { kind: 'recovered'; save: SaveData; from: number } // 壊れていたため、控えから復元した
  | { kind: 'lost'; error: string } // 控えからも復元できなかった(壊れた原本は退避して残す)
  | { kind: 'missing' };

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('保存を中止しました'));
  });

export class SaveStore {
  constructor(
    private db: IDBDatabase,
    private now: () => number = Date.now,
  ) {}

  static open(factory: IDBFactory = indexedDB, now: () => number = Date.now): Promise<SaveStore> {
    return new Promise((resolve, reject) => {
      const r = factory.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('saves', { keyPath: 'id' });
        db.createObjectStore('drafts', { keyPath: 'saveId' });
        db.createObjectStore('meta', { keyPath: 'key' });
        const snap = db.createObjectStore('snapshots', { keyPath: 'seq', autoIncrement: true });
        snap.createIndex('saveId', 'saveId');
        db.createObjectStore('quarantine', { keyPath: 'seq', autoIncrement: true });
      };
      r.onsuccess = () => resolve(new SaveStore(r.result, now));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('他の画面が使用中のため開けません'));
    });
  }

  close() {
    this.db.close();
  }

  async listSaves(): Promise<{ id: string; name: string; updatedAt: number }[]> {
    const all = (await req(this.db.transaction('saves').objectStore('saves').getAll())) as Partial<SaveData>[];
    return all
      .filter((s) => typeof s.id === 'string')
      .map((s) => ({ id: s.id as string, name: String(s.name ?? ''), updatedAt: Number(s.updatedAt ?? 0) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getActiveId(): Promise<string | undefined> {
    const m = await req(this.db.transaction('meta').objectStore('meta').get('activeSaveId'));
    return m?.value;
  }

  async setActiveId(id: string) {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key: 'activeSaveId', value: id });
    await done(tx);
  }

  async load(id: string): Promise<LoadResult> {
    const raw = await req(this.db.transaction('saves').objectStore('saves').get(id));
    if (raw === undefined) return { kind: 'missing' };
    const v = validateSave(raw);
    if (v.ok) return { kind: 'ok', save: v.save };

    // 壊れたデータは消さずに退避し、直近の正常な控えから復元する
    const snaps = ((await req(
      this.db.transaction('snapshots').objectStore('snapshots').index('saveId').getAll(id),
    )) as Snapshot[]).sort((a, b) => b.savedAt - a.savedAt);
    const tx = this.db.transaction(['quarantine', 'saves'], 'readwrite');
    tx.objectStore('quarantine').add({ saveId: id, savedAt: this.now(), error: v.error, data: raw });
    let recovered: LoadResult | null = null;
    for (const s of snaps) {
      const sv = validateSave(s.data);
      if (sv.ok) {
        tx.objectStore('saves').put(sv.save);
        recovered = { kind: 'recovered', save: sv.save, from: s.savedAt };
        break;
      }
    }
    // 復元できなかったときは、退避済みの壊れた原本を一覧から外す(原本は quarantine に残る)
    if (!recovered) tx.objectStore('saves').delete(id);
    await done(tx);
    return recovered ?? { kind: 'lost', error: v.error };
  }

  // 保存。上書きする前の状態は、一定間隔で復旧用の控えとして残す(直近 SNAPSHOT_KEEP 世代)
  async put(save: SaveData): Promise<void> {
    const tx = this.db.transaction(['saves', 'snapshots'], 'readwrite');
    const saves = tx.objectStore('saves');
    const snaps = tx.objectStore('snapshots');
    const prev = await req(saves.get(save.id));
    if (prev !== undefined && validateSave(prev).ok) {
      const mine = ((await req(snaps.index('saveId').getAll(save.id))) as Snapshot[]).sort((a, b) => a.savedAt - b.savedAt);
      const last = mine[mine.length - 1];
      if (!last || this.now() - last.savedAt >= SNAPSHOT_MIN_INTERVAL) {
        snaps.add({ saveId: save.id, savedAt: this.now(), data: prev });
        mine.push({ saveId: save.id, savedAt: this.now(), data: prev });
        while (mine.length > SNAPSHOT_KEEP) {
          const old = mine.shift() as Snapshot;
          if (old.seq !== undefined) snaps.delete(old.seq);
        }
      }
    }
    saves.put(save);
    await done(tx);
  }

  // 未送信の下書きは、セーブごとに別枠で保存する(正史には含めない)
  async putDraft(saveId: string, text: string) {
    const tx = this.db.transaction('drafts', 'readwrite');
    if (text) tx.objectStore('drafts').put({ saveId, text });
    else tx.objectStore('drafts').delete(saveId);
    await done(tx);
  }

  async getDraft(saveId: string): Promise<string> {
    const d = await req(this.db.transaction('drafts').objectStore('drafts').get(saveId));
    return typeof d?.text === 'string' ? d.text : '';
  }

  // セーブを消す。復旧用の控えと、下書きも、あわせて消す(壊れたデータの退避場所 quarantine は、そのまま残す)。
  // 使用中のセーブを消すかどうかの判断は、呼び出し側が行う
  async deleteSave(id: string): Promise<void> {
    const tx = this.db.transaction(['saves', 'drafts', 'snapshots'], 'readwrite');
    tx.objectStore('saves').delete(id);
    tx.objectStore('drafts').delete(id);
    const snaps = tx.objectStore('snapshots');
    const keys = (await req(snaps.index('saveId').getAllKeys(id))) as IDBValidKey[];
    for (const k of keys) snaps.delete(k);
    await done(tx);
  }

  async countSnapshots(saveId: string): Promise<number> {
    return req(this.db.transaction('snapshots').objectStore('snapshots').index('saveId').count(saveId));
  }

  async countQuarantined(): Promise<number> {
    return req(this.db.transaction('quarantine').objectStore('quarantine').count());
  }
}
