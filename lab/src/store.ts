// 比較テスト専用の保存先(端末内)。ゲーム本体のデータベースとは名前が違い、互いに触れない。
// APIキーは結果とは別の場所に置き、書き出しには含めない。
import type { RunResult } from './types';

export const LAB_DB = 'ai-world-game-lab';

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
  private constructor(private db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB): Promise<LabStore> {
    return new Promise((resolve, reject) => {
      const r = factory.open(LAB_DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('results', { keyPath: 'id' });
        r.result.createObjectStore('keys', { keyPath: 'provider' });
      };
      r.onsuccess = () => resolve(new LabStore(r.result));
      r.onerror = () => reject(r.error);
    });
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

  async getKey(provider: string): Promise<string | undefined> {
    const k = await req(this.db.transaction('keys').objectStore('keys').get(provider));
    return typeof k?.key === 'string' ? k.key : undefined;
  }

  async listKeyProviders(): Promise<string[]> {
    return (await req(this.db.transaction('keys').objectStore('keys').getAllKeys())) as string[];
  }

  async setKey(provider: string, key: string) {
    const tx = this.db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put({ provider, key: key.trim() });
    await done(tx);
  }

  async deleteKey(provider: string) {
    const tx = this.db.transaction('keys', 'readwrite');
    tx.objectStore('keys').delete(provider);
    await done(tx);
  }
}
