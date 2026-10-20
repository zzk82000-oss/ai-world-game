// 比較テスト専用の保存先(端末内)。ゲーム本体のデータベースとは名前が違い、互いに触れない。
// APIキーは保存しない。以前の版でキーを保存していた場所(keys)は、開いたときに丸ごと削除する。
import type { RunResult } from './types';

export const LAB_DB = 'ai-world-game-lab';
const DB_VERSION = 2; // 2: APIキーの保存場所(keys)を削除

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export class LabStore {
  private constructor(
    private db: IDBDatabase,
    readonly legacyKeysRemoved: boolean, // 以前の版で保存されたキーを今回削除したか
  ) {}

  static open(factory: IDBFactory = indexedDB): Promise<LabStore> {
    return new Promise((resolve, reject) => {
      let removed = false;
      const r = factory.open(LAB_DB, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('results')) db.createObjectStore('results', { keyPath: 'id' });
        if (db.objectStoreNames.contains('keys')) {
          db.deleteObjectStore('keys');
          removed = true;
        }
      };
      r.onsuccess = () => resolve(new LabStore(r.result, removed));
      r.onerror = () => reject(r.error);
    });
  }

  storeNames(): string[] {
    return [...this.db.objectStoreNames];
  }

  async putResult(result: RunResult) {
    const tx = this.db.transaction('results', 'readwrite');
    tx.objectStore('results').put(result);
    await done(tx);
  }

  async listResults(): Promise<RunResult[]> {
    const all = (await req(this.db.transaction('results').objectStore('results').getAll())) as RunResult[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async clearResults() {
    const tx = this.db.transaction('results', 'readwrite');
    tx.objectStore('results').clear();
    await done(tx);
  }
}
