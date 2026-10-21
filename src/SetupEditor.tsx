import { SETUP_MAX } from './game/save';

type Props = { value: string; onChange: (v: string) => void; onBack: () => void };

// セーブごとの設定メモ。関係や状況を、プレイヤー自身が決めて、AIに「最優先で守る設定」として渡す
export function SetupEditor({ value, onChange, onBack }: Props) {
  return (
    <div className="editor">
      <button className="link-btn" onClick={onBack}>
        ← メニューに戻る
      </button>
      <h2>設定メモ(関係・状況)</h2>
      <p className="note">
        このセーブの、人物どうしの関係や、いまの状況を書くと、AIは「プレイヤーが決めた設定」として、最優先で守ります。変更はすぐ自動で保存され、次の送信から反映されます。
      </p>
      <textarea
        className="setup-text"
        rows={10}
        maxLength={SETUP_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'例:\n・リオとカイは、3年前から付き合っている恋人どうし。\n・リオは、二人きりのときは皮肉を控えて、素直になる。\n・いまは夜。リオの薬屋の、閉店後の二階。'}
      />
      <p className="note">
        {value.length} / {SETUP_MAX} 文字。<br />
        登場人物の年齢の決まり(性的な場面に関われるのは21歳以上の人物だけ・合意に基づく)は、メモに何を書いても、変わりません。
        メモは、セーブとバックアップに含まれます(GitHubなどに載せないでください)。
      </p>
    </div>
  );
}
