import { useState } from 'react';
import type { SaveSummary } from './useGameSave';

type Props = {
  saves: SaveSummary[];
  activeId: string;
  onOpen: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onExport: () => { filename: string; text: string };
  onImport: (text: string) => Promise<{ ok: boolean; error?: string; name?: string }>;
  onBack: () => void;
};

const fmt = (t: number) => new Date(t).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });

export function SaveManager({ saves, activeId, onOpen, onExport, onImport, onBack }: Props) {
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const show = (text: string, error = false) => {
    setMessage(text);
    setIsError(error);
  };

  const doExport = () => {
    const { filename, text } = onExport();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    show(`「${filename}」を書き出しました。`);
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    const r = await onImport(await file.text());
    if (r.ok) show(`「${r.name}」として取り込みました。今のセーブは変わっていません。上の一覧から開けます。`);
    else show(r.error ?? '読み込めませんでした', true);
  };

  return (
    <div className="editor">
      <button className="link-btn" onClick={onBack}>
        ← メニューに戻る
      </button>
      <h2>セーブ</h2>
      <ul className="save-list">
        {saves.map((s) => (
          <li key={s.id} className={s.id === activeId ? 'active' : ''}>
            <div className="save-name">
              {s.name}
              <small>{fmt(s.updatedAt)}</small>
            </div>
            {s.id === activeId ? (
              <span className="note">使用中</span>
            ) : (
              <button
                onClick={async () => {
                  const r = await onOpen(s.id);
                  if (!r.ok) show(r.error ?? '開けませんでした', true);
                }}
              >
                開く
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3>バックアップ</h3>
      <div className="row">
        <button onClick={doExport}>書き出す</button>
        <label className="file-btn">
          読み込む
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              void doImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="note">
        読み込みは、今のセーブを上書きせず、別のセーブとして追加します。
        バックアップにはゲームの内容が入ります。GitHubなどに載せないでください。
      </p>
      {message && <p className={isError ? 'error' : 'note'}>{message}</p>}
    </div>
  );
}
