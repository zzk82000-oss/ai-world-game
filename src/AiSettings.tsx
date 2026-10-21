import { useState } from 'react';
import { DAILY_LIMIT } from './ai/usage';
import type { VaultStatus } from './ai/useVault';
import { ADULT_MIN_AGE } from './ai/narrator';
import { MIN_PASSPHRASE } from './ai/vault';
import { validProviderSlug } from '../lab/src/providers';

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
  adult: boolean;
  onAdult: (on: boolean) => void;
  providerPin: string;
  onProviderPin: (v: string) => void;
  onBack: () => void;
};

export function AiSettings({ status, onRegister, onUnlock, onLock, onForget, modelKey, onModel, usage, adult, onAdult, providerPin, onProviderPin, onBack }: Props) {
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

      <h3>提供元の指定(任意)</h3>
      <input
        value={providerPin}
        onChange={(e) => onProviderPin(e.target.value)}
        placeholder="空欄 = OpenRouter が選ぶ"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {providerPin.trim() !== '' && !validProviderSlug(providerPin.trim()) && <p className="error">識別名の形式が正しくありません(英数字と . _ / - のみ)。</p>}
      <p className="note">
        指定すると、その提供元だけに送り、使えなければ他へ切り替えずにエラーにします。ZDR(データを残さない)の提供元だけに限定します。
        識別名は、OpenRouter のモデルのページの提供元一覧で確認してください。提供元の利用規約は、自分で確認してください。
      </p>

      <h3>成人向けモード</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={adult}
          onChange={(e) => {
            if (!e.target.checked) return onAdult(false);
            if (
              confirm(
                `成人向けモードをオンにします。\n・性的な場面に関われるのは、${ADULT_MIN_AGE}歳以上と設定された人物だけです。\n・成人どうしの、合意に基づくフィクションです。\n・使うモデルと提供元の利用規約が、成人向けの内容を許可しているかを、自分で確認してから使ってください。\n\nオンにしますか？`,
              )
            )
              onAdult(true);
          }}
        />
        オン(既定はオフ)
      </label>
      <p className="note">
        オンにすると、AIへの指示に、成人向けの決まりが加わります。{ADULT_MIN_AGE}歳未満の人物(例: ミラ19歳)は、どんな場合も性的な場面に関わりません。
        規約上できないモデル・提供元では、拒否されたり、弱められたりします。
      </p>

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
