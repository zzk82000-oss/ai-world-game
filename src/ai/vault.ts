// APIキーを、パスフレーズで暗号化して、この端末(ブラウザの IndexedDB)にだけ保存する。
// - セーブデータとは別のデータベースに置く(バックアップの書き出しには入らない)。
// - 平文のキーは保存しない。復号したキーは画面のメモリ上にだけ置く(呼び出し側が持つ)。
// - パスフレーズは保存しない。忘れたときは、キーを消して入れ直す(キーは再発行できる)。
// 限界: 復号されたキーがメモリにある間に、端末が乗っ取られた場合は守れない。

export const VAULT_DB = 'ai-world-game-vault';
const STORE = 'vault';
export const VAULT_ENDPOINTS = ['openrouter', 'venice'] as const;
export type VaultEndpoint = (typeof VAULT_ENDPOINTS)[number];
const recordId = (ep: VaultEndpoint) => `${ep}-key`; // openrouter は従来と同じ 'openrouter-key'
const ITERATIONS = 300_000;
const AAD = new TextEncoder().encode('ai-world-game-key-v1');
export const MIN_PASSPHRASE = 8;

type Record_ = { id: string; v: 1; salt: Uint8Array; iv: Uint8Array; iterations: number; data: Uint8Array; savedAt: number };

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

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// キーとして受け付ける形か(空・空白入り・極端に短い/長いものは拒否)
export function validateApiKey(key: string): string | null {
  const k = key.trim();
  if (!k) return 'キーが入力されていません';
  if (/\s/.test(k)) return 'キーに空白や改行が含まれています(貼り付けをやり直してください)';
  if (k.length < 20 || k.length > 300) return 'キーの長さが正しくありません';
  return null;
}

export class KeyVault {
  private constructor(private db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB): Promise<KeyVault> {
    return new Promise((resolve, reject) => {
      const r = factory.open(VAULT_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(new KeyVault(r.result));
      r.onerror = () => reject(r.error);
    });
  }

  async hasKey(ep: VaultEndpoint = 'openrouter'): Promise<boolean> {
    return (await req(this.db.transaction(STORE).objectStore(STORE).get(recordId(ep)))) !== undefined;
  }

  async save(apiKey: string, passphrase: string, ep: VaultEndpoint = 'openrouter'): Promise<{ ok: true } | { ok: false; error: string }> {
    const bad = validateApiKey(apiKey);
    if (bad) return { ok: false, error: bad };
    if (passphrase.length < MIN_PASSPHRASE) return { ok: false, error: `パスフレーズは${MIN_PASSPHRASE}文字以上にしてください` };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, new TextEncoder().encode(apiKey.trim()));
    const rec: Record_ = { id: recordId(ep), v: 1, salt, iv, iterations: ITERATIONS, data: new Uint8Array(enc), savedAt: Date.now() };
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    await done(tx);
    return { ok: true };
  }

  // パスフレーズが違う(または壊れている)ときは null
  async unlock(passphrase: string, ep: VaultEndpoint = 'openrouter'): Promise<string | null> {
    const rec = (await req(this.db.transaction(STORE).objectStore(STORE).get(recordId(ep)))) as Record_ | undefined;
    if (!rec) return null;
    try {
      const key = await deriveKey(passphrase, rec.salt, rec.iterations);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv as BufferSource, additionalData: AAD }, key, rec.data as BufferSource);
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  async remove(ep: VaultEndpoint = 'openrouter'): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(recordId(ep));
    await done(tx);
  }

  close() {
    this.db.close();
  }
}
