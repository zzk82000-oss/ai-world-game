import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyVault, VAULT_ENDPOINTS, type VaultEndpoint } from './vault';

export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked' | 'unavailable';
type Statuses = Record<VaultEndpoint, VaultStatus>;
const initial = (): Statuses => ({ openrouter: 'loading', venice: 'loading' });

// 暗号化して保存したAPIキー(送信先ごと)の状態。復号したキーは、このフックの中(メモリ)にだけ置く。ページを閉じると消える。
// パスフレーズは、すべてのキーで共通のものを使えるが、キーごとに別々に保存・解錠する。
export function useVault() {
  const [statuses, setStatuses] = useState<Statuses>(initial);
  const vault = useRef<KeyVault | null>(null);
  const keys = useRef<Partial<Record<VaultEndpoint, string>>>({});
  const set = (ep: VaultEndpoint, s: VaultStatus) => setStatuses((prev) => ({ ...prev, [ep]: s }));

  useEffect(() => {
    let cancelled = false;
    KeyVault.open()
      .then(async (v) => {
        if (cancelled) return;
        vault.current = v;
        const next = initial();
        for (const ep of VAULT_ENDPOINTS) next[ep] = (await v.hasKey(ep)) ? 'locked' : 'none';
        if (!cancelled) setStatuses(next);
      })
      .catch(() => !cancelled && setStatuses({ openrouter: 'unavailable', venice: 'unavailable' }));
    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(async (ep: VaultEndpoint, apiKey: string, passphrase: string) => {
    if (!vault.current) return { ok: false as const, error: 'この端末のブラウザでは、キーを保存できません' };
    const r = await vault.current.save(apiKey, passphrase, ep);
    if (!r.ok) return r;
    keys.current[ep] = apiKey.trim();
    set(ep, 'unlocked');
    return { ok: true as const };
  }, []);

  // 保存済みのキーを、すべてまとめて解錠する(同じパスフレーズで復号できたものだけ)
  const unlock = useCallback(async (passphrase: string) => {
    let opened = 0;
    for (const ep of VAULT_ENDPOINTS) {
      if (!(await vault.current?.hasKey(ep))) continue;
      const k = await vault.current?.unlock(passphrase, ep);
      if (k) {
        keys.current[ep] = k;
        set(ep, 'unlocked');
        opened++;
      }
    }
    return opened ? { ok: true as const, opened } : { ok: false as const, error: 'パスフレーズが違います' };
  }, []);

  const lock = useCallback(() => {
    keys.current = {};
    setStatuses((prev) => {
      const next = { ...prev };
      for (const ep of VAULT_ENDPOINTS) if (next[ep] === 'unlocked') next[ep] = 'locked';
      return next;
    });
  }, []);

  const forget = useCallback(async (ep: VaultEndpoint) => {
    await vault.current?.remove(ep);
    delete keys.current[ep];
    set(ep, 'none');
  }, []);

  const getKey = useCallback((ep: VaultEndpoint) => keys.current[ep] ?? null, []);
  return { statuses, register, unlock, lock, forget, getKey };
}
