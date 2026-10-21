import { useState } from 'react';
import { yenPrecise } from './cost';
import { seriousLabels, totalScore } from './export';
import { CRITERIA, SERIOUS_ISSUES, type CriterionKey, type Evaluation, type RunResult, type SeriousKey } from './types';

const MECH_LABEL = { pass: '合格', warn: '注意', fail: '不合格', skip: '判定なし' } as const;
const HEUR_LABEL = { pass: '該当なし', warn: '要確認', fail: '要確認', skip: '判定なし' } as const;
const STATUS_LABEL = { success: '成功', error: '失敗', aborted: '停止' } as const;

const emptyEval = (): Evaluation => ({ scores: {}, reasons: {}, serious: {}, problemExample: '', comment: '', updatedAt: 0 });

export function ResultCard({ result, onSave }: { result: RunResult; onSave: (r: RunResult) => Promise<void> }) {
  const [ev, setEv] = useState<Evaluation>({ ...emptyEval(), ...result.evaluation, serious: result.evaluation?.serious ?? {} });
  const [saved, setSaved] = useState('');
  const total = totalScore({ ...result, evaluation: ev });
  const serious = seriousLabels({ ...result, evaluation: ev });

  const setScore = (k: CriterionKey, max: number, v: string) => {
    const n = v === '' ? undefined : Math.max(0, Math.min(max, Math.round(Number(v))));
    setEv({ ...ev, scores: { ...ev.scores, [k]: Number.isNaN(n) ? undefined : n } });
    setSaved('');
  };
  const toggleSerious = (k: SeriousKey, on: boolean) => {
    const next = { ...ev.serious };
    if (on) next[k] = next[k] ?? '';
    else delete next[k];
    setEv({ ...ev, serious: next });
    setSaved('');
  };

  const mechanical = result.checks.filter((c) => c.basis === 'mechanical');
  const heuristic = result.checks.filter((c) => c.basis === 'heuristic');

  return (
    <article className={`card ${serious.length ? 'serious' : ''}`}>
      <header className="card-head">
        <strong>{result.modelName}</strong>
        <span className={`badge ${result.status}`}>{STATUS_LABEL[result.status]}</span>
        <span className="badge">{result.live ? '実通信' : '模擬'}</span>
        <span className="badge">指示文 v{result.promptVersion ?? 1}</span>
        {result.track === 'stress' && <span className="badge stress">耐性テスト(追加検証)</span>}
        {serious.length > 0 && <span className="badge fail">重大問題 {serious.length}件</span>}
      </header>
      <p className="meta">
        シナリオ {result.scenarioId} ・ {result.repeat}回目 ・ {new Date(result.createdAt).toLocaleString('ja-JP')}
        <br />
        応答 {(result.latencyMs / 1000).toFixed(1)}秒 ・ 入力 {result.usage.inputTokens} / 出力 {result.usage.outputTokens} トークン
        {result.usage.reasoningTokens !== undefined ? `(うち推論 ${result.usage.reasoningTokens})` : ''}
        {result.usage.source === 'api' ? '(APIの値)' : '(概算)'}
        {result.live ? ` ・ 処理した提供元: ${result.servedBy ?? '不明(返ってこなかった)'}` : ''}
        <br />
        推定費用 {result.costJpy === undefined ? '料金未確認' : yenPrecise(result.costJpy)}
        {result.price ? `(単価 $${result.price.inputUsdPerM}/$${result.price.outputUsdPerM}・${result.price.checkedAt ?? '確認日不明'}時点)` : ''}・実際の請求額は未確認
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
          <div className="changes">
            <b>状態変更の提案</b>{' '}
            {result.parsed.changes === null
              ? `なし(${result.parsed.formatError ?? '形式どおりではありません'})`
              : result.parsed.changes.length
                ? JSON.stringify(result.parsed.changes)
                : '変更なし'}
            {result.parsed.promises.length > 0 && <div>約束: {JSON.stringify(result.parsed.promises)}</div>}
            <small>会話文と状態変更の提案は別々に確認してください(会話で値引きを約束していても、提案には出ないことがあります)。</small>
          </div>
          <details>
            <summary>元の文章・送った生成設定</summary>
            <pre>{result.output}</pre>
            <pre>
              指定値: {JSON.stringify(result.request.requestedParams)}
              {'\n'}送った値: {JSON.stringify(result.request.sentParams)}
              {result.request.paramNotes.length ? `\n注記: ${result.request.paramNotes.join(' / ')}` : ''}
              {result.endpoint ? `\n送信先: ${result.endpoint}` : ''}
            </pre>
          </details>
        </div>
      )}

      {mechanical.length > 0 && (
        <>
          <h4>自動検査(機械的に確定できるもの)</h4>
          <ul className="checks">
            {mechanical.map((c, i) => (
              <li key={i} className={c.outcome}>
                <b>{MECH_LABEL[c.outcome]}</b> {c.label}
                <small>{c.detail}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      {heuristic.length > 0 && (
        <>
          <h4>語句による確認(目安)</h4>
          <ul className="checks">
            {heuristic.map((c, i) => (
              <li key={i} className={c.outcome === 'pass' ? 'none' : 'warn'}>
                <b>{HEUR_LABEL[c.outcome]}</b> {c.label}
                <small>{c.detail}</small>
              </li>
            ))}
          </ul>
          <p className="note">語句の有無だけで違反・合格は決まりません。言い換えは検出できません。最終判断は採点で行ってください。</p>
        </>
      )}

      {result.status === 'success' && (
        <details className="eval" open={!result.evaluation}>
          <summary>
            採点 {total !== undefined ? `(合計 ${total}/100)` : '(未入力)'}
            {serious.length > 0 ? ` ・ 重大問題 ${serious.length}件` : ''}
          </summary>
          {CRITERIA.map((c) => (
            <div key={c.key} className="score-row">
              <label>
                {c.label}
                <input type="number" inputMode="numeric" min={0} max={c.max} value={ev.scores[c.key] ?? ''} onChange={(e) => setScore(c.key, c.max, e.target.value)} />
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
          <h4>重大問題(点数とは別に、確認したものだけ記録)</h4>
          {SERIOUS_ISSUES.map((s) => (
            <div key={s.key} className="serious-row">
              <label className="check">
                <input type="checkbox" checked={ev.serious[s.key] !== undefined} onChange={(e) => toggleSerious(s.key, e.target.checked)} />
                {s.label}
              </label>
              {ev.serious[s.key] !== undefined && (
                <input
                  className="reason"
                  placeholder="どこが問題か(引用など)"
                  value={ev.serious[s.key]}
                  onChange={(e) => setEv({ ...ev, serious: { ...ev.serious, [s.key]: e.target.value } })}
                />
              )}
            </div>
          ))}
          <p className="note">自動検査の「要確認」だけで重大問題とはしないでください。文章を読んで確認したものだけを記録します。</p>
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
