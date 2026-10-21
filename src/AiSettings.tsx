import { useState } from 'react';
import { DAILY_LIMIT } from './ai/usage';
import type { VaultStatus } from './ai/useVault';
import { ADULT_MIN_AGE, type ReplyLength } from './ai/narrator';
import { MIN_PASSPHRASE, type VaultEndpoint } from './ai/vault';
import { validProviderSlug } from '../lab/src/providers';

export const GAME_MODELS = [
  { key: 'deepseek-v4.1-flash-or', label: 'DeepSeek V4.1 Flash(OpenRouter・既定・安い)', endpoint: 'openrouter' },
  { key: 'glm-5.3-or', label: 'GLM 5.3(OpenRouter)', endpoint: 'openrouter' },
  { key: 'venice-uncensored-1-2', label: 'Venice Uncensored 1.2(Venice・成人向けに使える見込み)', endpoint: 'venice' },
  { key: 'venice-roleplay', label: 'Venice Uncensored Role-Play(Venice・日本語は不向き)', endpoint: 'venice' },
  { key: 'venice-custom', label: 'Venice のモデルを、IDで指定(下の欄)', endpoint: 'venice' },
] as const;

type Props = {
  statuses: Record<VaultEndpoint, VaultStatus>;
  onRegister: (ep: VaultEndpoint, apiKey: string, passphrase: string) => Promise<{ ok: boolean; error?: string }>;
  onUnlock: (passphrase: string) => Promise<{ ok: boolean; error?: string }>;
  onLock: () => void;
  onForget: (ep: VaultEndpoint) => Promise<void>;
  modelKey: string;
  onModel: (key: string) => void;
  usage: { count: number; limit: number };
  adult: boolean;
  onAdult: (on: boolean) => void;
  providerPin: string;
  onProviderPin: (v: string) => void;
  veniceModelId: string;
  onVeniceModelId: (v: string) => void;
  replyLength: ReplyLength;
  onReplyLength: (v: ReplyLength) => void;
  onBack: () => void;
};

const SERVICE = { openrouter: 'OpenRouter', venice: 'Venice' } as const;
const secretProps = { autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

// 送信先ごとのキーの登録欄
function KeyBox({ ep, status, onRegister, onForget, show }: { ep: VaultEndpoint; status: VaultStatus; onRegister: Props['onRegister']; onForget: Props['onForget']; show: (t: string, err?: boolean) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const register = async () => {
    if (pass !== pass2) return show('パスフレーズが一致しません', true);
    const r = await onRegister(ep, apiKey, pass);
    if (r.ok) {
      setApiKey('');
      setPass('');
      setPass2('');
      show(`${SERVICE[ep]} のキーを暗号化して保存しました。`);
    } else show(r.error ?? '保存できませんでした', true);
  };
  return (
    <div className="keybox">
      <h4>
        {SERVICE[ep]} のキー: {{ loading: '確認中', none: '未登録', locked: '保存済み(ロック中)', unlocked: '使えます', unavailable: '保存できません' }[status]}
      </h4>
      {status === 'none' && (
        <>
          <label className="field">
            APIキー(貼り付け)
            <input className="secret-input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} {...secretProps} />
          </label>
          <label className="field">
            パスフレーズ({MIN_PASSPHRASE}文字以上。解錠のときに使います)
            <input className="secret-input" value={pass} onChange={(e) => setPass(e.target.value)} {...secretProps} />
          </label>
          <label className="field">
            パスフレーズ(確認)
            <input className="secret-input" value={pass2} onChange={(e) => setPass2(e.target.value)} {...secretProps} />
          </label>
          <button onClick={() => void register()} disabled={!apiKey || !pass}>
            暗号化して保存する
          </button>
        </>
      )}
      {(status === 'locked' || status === 'unlocked') && (
        <button
          onClick={() => {
            if (confirm(`保存した ${SERVICE[ep]} のキーを、この端末から削除します。${SERVICE[ep]} 側のキーは消えません。削除しますか？`)) {
              void onForget(ep).then(() => show('キーを削除しました。'));
            }
          }}
        >
          キーを削除する
        </button>
      )}
    </div>
  );
}

export function AiSettings({ statuses, onRegister, onUnlock, onLock, onForget, modelKey, onModel, usage, adult, onAdult, providerPin, onProviderPin, veniceModelId, onVeniceModelId, replyLength, onReplyLength, onBack }: Props) {
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const show = (t: string, err = false) => {
    setMsg(t);
    setIsError(err);
  };
  const anyLocked = Object.values(statuses).includes('locked');
  const anyUnlocked = Object.values(statuses).includes('unlocked');
  const chosen = GAME_MODELS.find((m) => m.key === modelKey);

  const unlock = async () => {
    const r = await onUnlock(pass);
    if (r.ok) {
      setPass('');
      show('解錠しました。');
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
      {chosen && statuses[chosen.endpoint] !== 'unlocked' && <p className="notice">このモデルは {SERVICE[chosen.endpoint]} のキーが必要です(下で登録・解錠してください)。</p>}

      {modelKey === 'venice-custom' && (
        <>
          <label className="field">
            Venice のモデルID(Venice のモデルのページ・API の欄に書かれている識別名)
            <input value={veniceModelId} onChange={(e) => onVeniceModelId(e.target.value)} placeholder="例: モデルのページで確認したID" {...secretProps} />
          </label>
          {veniceModelId.trim() !== '' && !validProviderSlug(veniceModelId.trim()) && <p className="error">IDの形式が正しくありません(英数字と . _ / - のみ)。</p>}
          <p className="note">IDが違うと、送信時に「モデルが見つかりません」のようなエラーになります(費用はかかりません)。料金は、Venice のページで確認してください(費用の概算は、この欄では計算しません)。</p>
        </>
      )}

      <h3>返答の長さ</h3>
      <select value={replyLength} onChange={(e) => onReplyLength(e.target.value as ReplyLength)}>
        <option value="compact">短め(セリフ → 状況の説明 → セリフ で終える・既定)</option>
        <option value="normal">長め(従来どおり・AIにおまかせ)</option>
      </select>

      <h3>成人向けモード</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={adult}
          onChange={(e) => {
            if (!e.target.checked) return onAdult(false);
            if (
              confirm(
                `成人向けモードをオンにします。\n・性的な場面に関われるのは、${ADULT_MIN_AGE}歳以上と設定された人物だけです。\n・成人どうしの、合意に基づくフィクションです。\n・使うモデルと送信先の利用規約が、成人向けの内容を許可しているかを、自分で確認してから使ってください。\n・Venice の規約(10.9(c))は、「ポルノ的・わいせつ」と受け取られうる内容を、送らないことを保証させています。規約違反とされると、警告・内容の遮断・アカウントの停止(返金なし)がありえます。公式への確認は、まだ済んでいません。\n\nオンにしますか？`,
              )
            )
              onAdult(true);
          }}
        />
        オン(既定はオフ)
      </label>
      <p className="note">
        オンにすると、AIへの指示に、成人向けの決まりが加わります。{ADULT_MIN_AGE}歳未満の人物(例: ミラ19歳)は、どんな場合も性的な場面に関わりません。
        規約上できない送信先では、拒否されたり、弱められたりします。
        OpenRouter のモデルでは、下の「提供元の指定」が必須です(未設定のままでは送信しません)。Venice のモデルは、指定は不要です。
      </p>

      <h3>キー(暗号化して、この端末にだけ保存)</h3>
      <KeyBox ep="openrouter" status={statuses.openrouter} onRegister={onRegister} onForget={onForget} show={show} />
      <KeyBox ep="venice" status={statuses.venice} onRegister={onRegister} onForget={onForget} show={show} />

      {anyLocked && (
        <>
          <p>保存済みのキーを使うには、パスフレーズを入れて、解錠してください(登録時と同じパスフレーズのキーが、まとめて解錠されます)。</p>
          <label className="field">
            パスフレーズ
            <input className="secret-input" value={pass} onChange={(e) => setPass(e.target.value)} {...secretProps} />
          </label>
          <button onClick={() => void unlock()} disabled={!pass}>
            解錠する
          </button>
        </>
      )}
      {anyUnlocked && (
        <div className="row">
          <button onClick={onLock}>ロックする(メモリから消す)</button>
        </div>
      )}
      {msg && <p className={isError ? 'error' : 'note'}>{msg}</p>}
      <p className="note">
        キーは、パスフレーズで暗号化して、この端末の中にだけ保存します(パスフレーズは保存しません)。セーブやバックアップには入りません。
        公開しているコードにも入っていません。パスフレーズを忘れたときは、キーを削除して、入れ直してください(キーは各サービスで再発行できます)。
        キーには、各サービス側で使用額の上限を設定しておいてください。
      </p>

      <h3>提供元の指定(OpenRouter のみ・任意)</h3>
      <input value={providerPin} onChange={(e) => onProviderPin(e.target.value)} placeholder="空欄 = OpenRouter が選ぶ" {...secretProps} />
      {providerPin.trim() !== '' && !validProviderSlug(providerPin.trim()) && <p className="error">識別名の形式が正しくありません(英数字と . _ / - のみ)。</p>}
      <p className="note">
        指定すると、その提供元だけに送り、使えなければ他へ切り替えずにエラーにします。ZDR(データを残さない)の提供元だけに限定します。
        識別名は、OpenRouter のモデルのページの提供元一覧で確認してください。提供元の利用規約は、自分で確認してください。
      </p>

      <h3>今日の呼び出し回数</h3>
      <p>
        {usage.count} / {usage.limit || DAILY_LIMIT} 回(日本時間で日付が変わるとリセットされます)
      </p>
    </div>
  );
}
