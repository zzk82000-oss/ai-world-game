import { useState } from 'react';
import { DAILY_LIMIT } from './ai/usage';
import type { VaultStatus } from './ai/useVault';
import { MIN_PASSPHRASE } from './ai/vault';

export const GAME_MODELS = [
  { key: 'deepseek-v4.1-flash-or', label: 'DeepSeek V4.1 Flash(既定・安い)' },
  { key: 'glm-5.3-or', label: 'GLM 5.3' },
] as const;

type Props = {
  status: VaultStatus;
  onRegister: (apiKey: string, passphrase: string) => Promise<{ ok: boolean; error?: string }>;
  onUnlock: (passphrase: string) => Promise<{ ok: boolean; error?: string }>;
  onLock: () => void;
  onForget: () => Promise<void>;
  modelKey: string;
  onModel: (key: string) => void;
  usage: { count: number; limit: number };
  onBack: () => void;
};

export function AiSettings({ status, onRegister, onUnlock, onLock, onForget, modelKey, onModel, usage, onBack }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const show = (t: string, err = false) => {
    setMsg(t);
    setIsError(err);
  };

  const register = async () => {
    if (pass !== pass2) return show('パスフレーズが一致しません', true);
    const r = await onRegister(apiKey, pass);
    if (r.ok) {
      setApiKey('');
      setPass('');
      setPass2('');
      show('キーを暗号化して保存しました。AIにつながっています。');
    } else show(r.error ?? '保存できませんでした', true);
  };

  const unlock = async () => {
    const r = await onUnlock(pass);
    if (r.ok) {
      setPass('');
      show('解錠しました。AIにつながっています。');
    } else show(r.error ?? '解錠できませんでした', true);
  };

  return (
    <div className="editor">
      <button className="link-btn" onClick={onBack}>
        ← メニューに戻る
      </button>
      <h2>AIの設定</h2>

      <h3>使うモデル</h3>
      <select value={modelKey} onChange={(e) => onModel(e.target.value)}>
        {GAME_MODELS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>

      <h3>今日の呼び出し回数</h3>
      <p>
        {usage.count} / {usage.limit || DAILY_LIMIT} 回(日本時間で日付が変わるとリセットされます)
      </p>

      <h3>APIキー(OpenRouter)</h3>
      {status === 'loading' && <p className="note">確認中…</p>}
      {status === 'unavailable' && <p className="error">この端末のブラウザでは、キーを保存できません。</p>}

      {status === 'none' && (
        <>
          <label className="field">
            APIキー(貼り付け)
            <input className="secret-input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="field">
            パスフレーズ({MIN_PASSPHRASE}文字以上。毎回の起動時に使います)
            <input className="secret-input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="field">
            パスフレーズ(確認)
            <input className="secret-input" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <button onClick={() => void register()} disabled={!apiKey || !pass}>
            暗号化して保存する
          </button>
        </>
      )}

      {status === 'locked' && (
        <>
          <p>キーは暗号化して保存されています。パスフレーズを入れると、AIにつながります。</p>
          <label className="field">
            パスフレーズ
            <input className="secret-input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <button onClick={() => void unlock()} disabled={!pass}>
            解錠する
          </button>
        </>
      )}

      {status === 'unlocked' && (
        <>
          <p>AIにつながっています。</p>
          <div className="row">
            <button onClick={onLock}>ロックする(メモリから消す)</button>
          </div>
        </>
      )}

      {(status === 'locked' || status === 'unlocked') && (
        <div className="row">
          <button
            onClick={() => {
              if (confirm('保存したキーを、この端末から削除します。OpenRouter 側のキーは消えません。削除しますか？')) {
                void onForget().then(() => show('キーを削除しました。'));
              }
            }}
          >
            キーを削除する
          </button>
        </div>
      )}

      {msg && <p className={isError ? 'error' : 'note'}>{msg}</p>}

      <p className="note">
        キーは、パスフレーズで暗号化して、この端末の中にだけ保存します(パスフレーズは保存しません)。セーブやバックアップには入りません。
        公開しているコードにも入っていません。パスフレーズを忘れたときは、キーを削除して、入れ直してください(キーは OpenRouter で再発行できます)。
        キーには、OpenRouter 側で利用上限を設定しておいてください。
      </p>
    </div>
  );
}
