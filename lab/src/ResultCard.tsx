import { useState } from 'react';
import { totalScore } from './export';
import { yenPrecise } from './cost';
import { CRITERIA, type CriterionKey, type Evaluation, type RunResult } from './types';

const OUTCOME_LABEL = { pass: '合格', warn: '要確認', fail: '不合格', skip: '判定なし' } as const;
const STATUS_LABEL = { success: '成功', error: '失敗', aborted: '停止' } as const;

export function ResultCard({ result, onSave }: { result: RunResult; onSave: (r: RunResult) => Promise<void> }) {
  const [ev, setEv] = useState<Evaluation>(
    result.evaluation ?? { scores: {}, reasons: {}, problemExample: '', comment: '', updatedAt: 0 },
  );
  const [saved, setSaved] = useState('');
  const total = totalScore({ ...result, evaluation: ev });

  const setScore = (k: CriterionKey, max: number, v: string) => {
    const n = v === '' ? undefined : Math.max(0, Math.min(max, Math.round(Number(v))));
    setEv({ ...ev, scores: { ...ev.scores, [k]: Number.isNaN(n) ? undefined : n } });
    setSaved('');
  };

  return (
    <article className="card">
      <header className="card-head">
        <strong>{result.modelName}</strong>
        <span className={`badge ${result.status}`}>{STATUS_LABEL[result.status]}</span>
        <span className="badge">{result.live ? '実通信' : '模擬'}</span>
      </header>
      <p className="meta">
        シナリオ {result.scenarioId} ・ {result.repeat}回目 ・ {new Date(result.createdAt).toLocaleString('ja-JP')}
        <br />
        応答 {(result.latencyMs / 1000).toFixed(1)}秒 ・ 入力 {result.usage.inputTokens} / 出力 {result.usage.outputTokens} トークン
        {result.usage.estimated ? '(推定)' : ''} ・ 費用 {result.costJpy === undefined ? '料金未確認' : yenPrecise(result.costJpy)}
      </p>
      {result.error && <p className="error">{result.error}</p>}

      {result.parsed && (
        <div className="output">
          {result.parsed.blocks.map((b, i) =>
            b.type === 'speech' ? (
              <p key={i} className="speech">
                <span className="speaker">{b.speaker}</span>「{b.text}」
              </p>
            ) : (
              <p key={i} className="narration">
                {b.text}
              </p>
            ),
          )}
          <details>
            <summary>状態変更の提案・元の文章</summary>
            <pre>{JSON.stringify({ changes: result.parsed.changes, promises: result.parsed.promises }, null, 2)}</pre>
            <pre>{result.output}</pre>
          </details>
        </div>
      )}

      {result.checks.length > 0 && (
        <ul className="checks">
          {result.checks.map((c, i) => (
            <li key={i} className={c.outcome}>
              <b>{OUTCOME_LABEL[c.outcome]}</b> {c.label}
              <small>{c.detail}</small>
            </li>
          ))}
        </ul>
      )}

      {result.status === 'success' && (
        <details className="eval" open={!result.evaluation}>
          <summary>採点 {total !== undefined ? `(合計 ${total}/100)` : '(未入力)'}</summary>
          {CRITERIA.map((c) => (
            <div key={c.key} className="score-row">
              <label>
                {c.label}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={c.max}
                  value={ev.scores[c.key] ?? ''}
                  onChange={(e) => setScore(c.key, c.max, e.target.value)}
                />
                <span>/ {c.max}</span>
              </label>
              <input
                className="reason"
                placeholder="判断の理由"
                value={ev.reasons[c.key] ?? ''}
                onChange={(e) => setEv({ ...ev, reasons: { ...ev.reasons, [c.key]: e.target.value } })}
              />
            </div>
          ))}
          <textarea placeholder="問題のあった出力の例(引用)" value={ev.problemExample} onChange={(e) => setEv({ ...ev, problemExample: e.target.value })} />
          <textarea placeholder="コメント" value={ev.comment} onChange={(e) => setEv({ ...ev, comment: e.target.value })} />
          <button
            onClick={async () => {
              await onSave({ ...result, evaluation: { ...ev, updatedAt: Date.now() } });
              setSaved('保存しました');
            }}
          >
            採点を保存
          </button>
          {saved && <span className="note"> {saved}</span>}
        </details>
      )}
    </article>
  );
}
