import { useState } from 'react';
import type { SaveSummary } from './useGameSave';

type Props = {
  saves: SaveSummary[];
  activeId: string;
  onOpen: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onExport: () => { filename: string; text: string };
  onDelete: (ids: string[]) => Promise<{ ok: boolean; error?: string; count?: number }>;
  onNew: () => Promise<{ ok: boolean; error?: string; name?: string }>;
  onImport: (text: string) => Promise<{ ok: boolean; error?: string; name?: string }>;
  onBack: () => void;
};

const fmt = (t: number) => new Date(t).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });

export function SaveManager({ saves, activeId, onOpen, onDelete, onNew, onExport, onImport, onBack }: Props) {
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
              <span className="row">
                <button
                  onClick={async () => {
                    const r = await onOpen(s.id);
                    if (!r.ok) show(r.error ?? '開けませんでした', true);
                  }}
                >
                  開く
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`セーブ「${s.name}」を消します。元に戻せません。\n(先にバックアップを書き出しておくと、あとで取り込めます)\n消しますか？`)) return;
                    const r = await onDelete([s.id]);
                    if (r.ok) show(`「${s.name}」を消しました。`);
                    else show(r.error ?? '消せませんでした', true);
                  }}
                >
                  消す
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="row">
        <button
          onClick={async () => {
            const r = await onNew();
            if (r.ok) show(`「${r.name}」をはじめから始めました。これまでのセーブは残っています。`);
            else show(r.error ?? '始められませんでした', true);
          }}
        >
          新しくはじめる
        </button>
      </div>
      <p className="note">今のセーブは消さず、別のセーブとして、はじめから始めます。</p>

      {saves.length > 1 && (
        <div className="row">
          <button
            onClick={async () => {
              const others = saves.filter((x) => x.id !== activeId);
              if (!confirm(`使用中のセーブ以外の ${others.length} 件を、すべて消します。元に戻せません。\n(先にバックアップを書き出しておくと、あとで取り込めます)\n消しますか？`)) return;
              const r = await onDelete(others.map((x) => x.id));
              if (r.ok) show(`${r.count} 件のセーブを消しました。使用中のセーブは残っています。`);
              else show(r.error ?? '消せませんでした', true);
            }}
          >
            使用中以外を、すべて消す
          </button>
        </div>
      )}

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
