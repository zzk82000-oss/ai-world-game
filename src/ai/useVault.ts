import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyVault } from './vault';

export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked' | 'unavailable';

// 暗号化して保存したAPIキーの状態。復号したキーは、このフックの中(メモリ)にだけ置く。ページを閉じると消える。
export function useVault() {
  const [status, setStatus] = useState<VaultStatus>('loading');
  const vault = useRef<KeyVault | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    KeyVault.open()
      .then(async (v) => {
        if (cancelled) return;
        vault.current = v;
        setStatus((await v.hasKey()) ? 'locked' : 'none');
      })
      .catch(() => !cancelled && setStatus('unavailable'));
    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(async (apiKey: string, passphrase: string) => {
    if (!vault.current) return { ok: false as const, error: 'この端末のブラウザでは、キーを保存できません' };
    const r = await vault.current.save(apiKey, passphrase);
    if (!r.ok) return r;
    key.current = apiKey.trim();
    setStatus('unlocked');
    return { ok: true as const };
  }, []);

  const unlock = useCallback(async (passphrase: string) => {
    const k = await vault.current?.unlock(passphrase);
    if (!k) return { ok: false as const, error: 'パスフレーズが違います' };
    key.current = k;
    setStatus('unlocked');
    return { ok: true as const };
  }, []);

  const lock = useCallback(() => {
    key.current = null;
    setStatus('locked');
  }, []);

  const forget = useCallback(async () => {
    await vault.current?.remove();
    key.current = null;
    setStatus('none');
  }, []);

  const getKey = useCallback(() => key.current, []);
  return { status, register, unlock, lock, forget, getKey };
}
