import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callCostUsd, DEFAULT_RATE, measuredUsage, monthlyCost, priceKnown, RATE_NOTE, USAGE_LEVELS, yen, yenPrecise } from './cost';
import { scenarioById, scenarios } from './data/scenarios';
import { checkBrowserAccess, ENDPOINTS, liveBlockReason } from './endpoints';
import { COMPARISON_LABEL, comparisonKind, hasSerious, toCsv, toJson, totalScore } from './export';
import { modelByKey, models } from './models';
import { buildMessages, GENERATION_PARAMS, PROMPT_VERSION } from './prompt';
import { buildSentParams, estimateInputTokens } from './providers';
import { ResultCard } from './ResultCard';
import { runOne } from './runner';
import { LabStore } from './store';
import { CRITERIA, OVERALL_RATINGS, type ModelInfo, type RunEnv, type RunResult } from './types';

type Tab = 'run' | 'results' | 'cost' | 'models' | 'settings';
const TABS: [Tab, string][] = [['run', '実行'], ['results', '結果'], ['cost', '費用'], ['models', 'モデル'], ['settings', '設定']];
const KEY_TTL_MS = 15 * 60 * 1000; // 入力したキーは15分で自動的に破棄する

const standardScenarios = scenarios.filter((s) => s.track === 'standard');
const stressScenarios = scenarios.filter((s) => s.track === 'stress');
const controlScenarios = scenarios.filter((s) => s.track === 'control');

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// APIキーは React のメモリ上にだけ置く(端末には保存しない)。再読み込み・タブを閉じる・15分経過・破棄で消える
function useMemoryKeys() {
  const keys = useRef<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [present, setPresent] = useState<string[]>([]);
  const sync = () => setPresent(Object.keys(keys.current));
  const discard = useCallback((id: string) => {
    delete keys.current[id];
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    sync();
  }, []);
  const set = useCallback(
    (id: string, key: string) => {
      keys.current[id] = key.trim();
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => discard(id), KEY_TTL_MS);
      sync();
    },
    [discard],
  );
  const discardAll = useCallback(() => Object.keys(keys.current).forEach(discard), [discard]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  const keyFor = useCallback((id: string) => keys.current[id], []);
  return { present, set, discard, discardAll, keyFor };
}

export default function LabApp() {
  const [tab, setTab] = useState<Tab>('run');
  const [store, setStore] = useState<LabStore | null>(null);
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const keys = useMemoryKeys();

  useEffect(() => {
    LabStore.open()
      .then(async (s) => {
        setStore(s);
        setResults(await s.listResults());
        if (s.legacyKeysRemoved) setNotice('以前の版でこの端末に保存されていたAPIキーを削除しました。今後、キーは保存しません。');
      })
      .catch(() => setNotice('この端末のブラウザでは保存できません。結果は保存されません。'));
  }, []);

  const saveResult = async (r: RunResult) => {
    if (store) await store.putResult(r);
    setResults((prev) => [r, ...prev.filter((x) => x.id !== r.id)].sort((a, b) => b.createdAt - a.createdAt));
  };

  return (
    <div className="lab">
      <header className="lab-head">
        <h1>文章AI 比較テスト</h1>
        <p className="note">ゲーム本体とは別の環境です。本体のセーブには触れません。</p>
        {notice && <p className="error">{notice}</p>}
      </header>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'run' && <RunTab keys={keys} verified={verified} rate={rate} onResult={saveResult} />}
        {tab === 'results' && (
          <ResultsTab
            results={results}
            onSave={saveResult}
            onClear={async () => {
              if (store) await store.clearResults();
              setResults([]);
            }}
          />
        )}
        {tab === 'cost' && <CostTab rate={rate} setRate={setRate} results={results} />}
        {tab === 'models' && <ModelsTab />}
        {tab === 'settings' && <SettingsTab keys={keys} verified={verified} setVerified={setVerified} />}
      </main>
    </div>
  );
}

type Keys = ReturnType<typeof useMemoryKeys>;

const ENV_KEY = 'ai-lab-run-env'; // ZDR・メモの入力値だけ(キーや結果は入れない)
function loadEnv(): RunEnv {
  try {
    const v = JSON.parse(localStorage.getItem(ENV_KEY) ?? 'null');
    if (v && ['on', 'off', 'unknown'].includes(v.zdr)) return { zdr: v.zdr, note: typeof v.note === 'string' ? v.note : '' };
  } catch { /* 読めなければ未確認 */ }
  return { zdr: 'unknown', note: '' };
}

function RunTab({ keys, verified, rate, onResult }: { keys: Keys; verified: Set<string>; rate: number; onResult: (r: RunResult) => Promise<void> }) {
  const [modelKey, setModelKey] = useState('mock-good');
  const [scenarioId, setScenarioId] = useState('A');
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [last, setLast] = useState<RunResult[]>([]);
  const [env, setEnv] = useState<RunEnv>(loadEnv);
  const updateEnv = (next: RunEnv) => {
    setEnv(next);
    try { localStorage.setItem(ENV_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動く */ }
  };
  const abortRef = useRef<AbortController | null>(null);

  const model = modelByKey(modelKey)!;
  const scenario = scenarioById(scenarioId)!;
  const messages = useMemo(() => buildMessages(scenario), [scenario]);
  const inTok = estimateInputTokens(messages);
  const { sent, notes } = buildSentParams(model, GENERATION_PARAMS);
  const maxOut = typeof sent.max_tokens === 'number' ? sent.max_tokens : undefined;
  const estUsd = maxOut === undefined ? undefined : callCostUsd(model, inTok, maxOut);
  const isLive = model.adapter === 'openai';
  const ep = model.endpointId ? ENDPOINTS[model.endpointId] : undefined;
  const blocked = model.adapter === 'none' ? 'このモデルは接続方法・利用条件が確認できていないため、実行できません(「モデル」タブ参照)。' : isLive ? liveBlockReason(ep, verified) : null;
  const needKey = isLive && !blocked && ep && !keys.present.includes(ep.id);

  const run = async (targets: { id: string; repeat: number }[]) => {
    const ac = new AbortController();
    abortRef.current = ac;
    const done: RunResult[] = [];
    for (const [i, t] of targets.entries()) {
      if (ac.signal.aborted) break;
      setBusy(`${i + 1} / ${targets.length} を実行中…`);
      const r = await runOne(model, scenarioById(t.id)!, { repeat: t.repeat, keyFor: keys.keyFor, verifiedEndpoints: verified, signal: ac.signal, rate, env });
      await onResult(r);
      done.push(r);
      setLast([...done].reverse());
    }
    setBusy('');
    abortRef.current = null;
  };
  const times3 = (list: typeof scenarios) => list.flatMap((s) => [1, 2, 3].map((repeat) => ({ id: s.id, repeat })));

  return (
    <section>
      <label className="field">
        モデル
        <select value={modelKey} onChange={(e) => { setModelKey(e.target.value); setConfirming(false); }}>
          {models.map((m) => (
            <option key={m.key} value={m.key}>
              {m.displayName}【{m.status}】
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        シナリオ
        <select value={scenarioId} onChange={(e) => { setScenarioId(e.target.value); setConfirming(false); }}>
          <optgroup label="通常の評価">
            {standardScenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </optgroup>
          <optgroup label="追加検証(通常の評価と混ぜない)">
            {stressScenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </optgroup>
          <optgroup label="対照テスト(履歴の影響を見る。B1・B2と混ぜない)">
            {controlScenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </optgroup>
        </select>
      </label>

      <div className="card">
        <h4>実行環境の記録</h4>
        <label className="field">
          OpenRouter の ZDR(データを残さない設定)
          <select value={env.zdr} onChange={(e) => updateEnv({ ...env, zdr: e.target.value as RunEnv['zdr'] })}>
            <option value="unknown">未確認</option>
            <option value="on">オン</option>
            <option value="off">オフ</option>
          </select>
        </label>
        <label className="field">
          規約確認などのメモ(任意)
          <input value={env.note} onChange={(e) => updateEnv({ ...env, note: e.target.value })} placeholder="例: 提供元の盾マークは緑" />
        </label>
        <p className="note">あなたが入力した値を、各結果に記録します。提供元が実際にそう処理したことの証明ではありません。</p>
      </div>

      <div className={`card ${scenario.track === 'stress' ? 'stress-card' : ''}`}>
        <p>{scenario.purpose}</p>
        {scenario.note && <p className="note">※ {scenario.note}</p>}
        <p className="meta">プレイヤーの入力: {scenario.playerInput}(指示文 v{PROMPT_VERSION})</p>
        <ul className="plain">{scenario.checks.map((c) => <li key={c}>・{c}</li>)}</ul>
        <details>
          <summary>モデルに送る内容を見る(約{inTok.toLocaleString()}トークン)</summary>
          {messages.map((m, i) => (
            <pre key={i} className={`msg ${m.role}`}>
              <b>{{ system: '設定', user: 'プレイヤー', assistant: '過去の返答' }[m.role]}</b>
              {'\n'}
              {m.content}
            </pre>
          ))}
          <p className="meta">
            共通の指定値: {JSON.stringify(GENERATION_PARAMS)} / このモデルに送る値: {JSON.stringify(sent)}
            {notes.length ? ` / 注記: ${notes.join(' / ')}` : ''}
          </p>
        </details>
      </div>

      {blocked && <p className="error">{blocked}</p>}
      {needKey && <p className="error">{ep!.provider} のAPIキーが入力されていません。「設定」タブで入力すると実行できます(保存はされません)。</p>}

      {busy ? (
        <div className="row">
          <span>{busy}</span>
          <button onClick={() => abortRef.current?.abort()}>停止</button>
        </div>
      ) : !isLive ? (
        <div className="row wrap">
          <button disabled={!!blocked} onClick={() => run([{ id: scenarioId, repeat: 1 }])}>模擬で実行</button>
          <button disabled={!!blocked} onClick={() => run(times3(standardScenarios))}>
            第1段階を一括(通常{standardScenarios.length}シナリオ×3回={standardScenarios.length * 3}件・模擬のみ)
          </button>
          <button disabled={!!blocked} onClick={() => run(times3(stressScenarios))}>
            耐性テストを一括({stressScenarios.map((s) => s.id).join('・')}×3回={stressScenarios.length * 3}件・模擬のみ)
          </button>
        </div>
      ) : !confirming ? (
        <button disabled={!!blocked || !!needKey} onClick={() => { setConfirming(true); setAgreed(false); setTermsChecked(false); }}>
          送信内容と費用を確認する
        </button>
      ) : (
        <div className="card confirm">
          <h3>実際に送信する前の確認</h3>
          <ul className="plain">
            <li>モデル: {model.displayName}</li>
            <li>モデルID: {model.apiModelId}</li>
            <li>送信先: {ep!.url}(許可リストの送信先・HTTPS)</li>
            <li>送る内容: 上の「モデルに送る内容」(架空のテスト用データ)</li>
            <li>送る生成設定: {JSON.stringify(sent)}{notes.length ? `(${notes.join(' / ')})` : ''}</li>
            {model.reasoning && model.reasoning !== '未確認' && <li>推論: {model.reasoning}</li>}
            <li>入力 約{inTok.toLocaleString()}トークン(概算)・出力の上限 {maxOut ?? '未指定'}トークン</li>
            <li>
              推定費用: {estUsd === undefined ? '料金未確認のため不明' : `約${yenPrecise(estUsd * rate)}($${estUsd.toFixed(5)})`}
              <br />
              <small>出力が上限まで出た場合の推定です。入力トークン数は概算で、推論の扱いも未確認のため、保証された上限ではありません。実際の請求額は未確認です。</small>
            </li>
            <li>送信は1回だけです。失敗しても自動で再試行しません。</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={termsChecked} onChange={(e) => setTermsChecked(e.target.checked)} />
            <span>
              {ep!.provider} の<a href={ep!.termsUrl} target="_blank" rel="noreferrer">利用規約</a>と、このモデルの利用条件(「モデル」タブ)を確認しました
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> 送信先・送信内容・費用を確認しました
          </label>
          <div className="row">
            <button disabled={!agreed || !termsChecked} onClick={() => { setConfirming(false); void run([{ id: scenarioId, repeat: 1 }]); }}>
              1回だけ送信する
            </button>
            <button onClick={() => setConfirming(false)}>やめる</button>
          </div>
        </div>
      )}

      {last.map((r) => <ResultCard key={r.id} result={r} onSave={onResult} />)}
    </section>
  );
}

function summarize(rs: RunResult[]) {
  const ok = rs.filter((r) => r.status === 'success');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const scored = ok.map(totalScore).filter((x): x is number => x !== undefined);
  const mech = ok.flatMap((r) => r.checks).filter((c) => c.basis === 'mechanical' && c.outcome !== 'skip');
  return {
    runs: rs.length,
    failed: rs.length - ok.length,
    avgTotal: avg(scored),
    scoredCount: scored.length,
    perCriterion: CRITERIA.map((c) => avg(ok.map((r) => r.evaluation?.scores[c.key]).filter((x): x is number => typeof x === 'number'))),
    mechFails: mech.filter((c) => c.outcome === 'fail').length,
    mechTotal: mech.length,
    warns: ok.flatMap((r) => r.checks).filter((c) => c.outcome === 'warn').length,
    serious: ok.filter(hasSerious).length,
    seriousUnjudged: ok.filter((r) => r.quick && r.quick.serious === 'unknown' && !hasSerious(r)).length,
    ratings: OVERALL_RATINGS.map((o) => ok.filter((r) => r.quick?.overall === o).length),
    unrated: ok.filter((r) => !r.quick?.overall).length,
    avgLatency: avg(ok.map((r) => r.latencyMs)),
    avgCost: avg(ok.map((r) => r.costJpy).filter((x): x is number => x !== undefined)),
  };
}

// モデル × シナリオごとの、実通信(指示文v2・成功)の回数。追加実測の回数を決めるための表
function CountTable({ results }: { results: RunResult[] }) {
  const live = results.filter((r) => r.live && r.status === 'success' && (r.promptVersion ?? 1) === PROMPT_VERSION);
  const names = [...new Set(live.map((r) => r.modelName))];
  if (!names.length) return <p className="note">まだ実通信の結果がありません。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>モデル</th>{scenarios.map((s) => <th key={s.id}>{s.id}</th>)}</tr>
        </thead>
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <td>{n}</td>
              {scenarios.map((s) => <td key={s.id}>{live.filter((r) => r.modelName === n && r.scenarioId === s.id).length}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareTable({ results }: { results: RunResult[] }) {
  const groups = new Map<string, RunResult[]>();
  // 指示文の版が違う結果、共通条件と実運用(個別設定あり)の結果は混ぜずに、別の行にする
  for (const r of results) {
    const k = `${r.modelName}(指示文v${r.promptVersion ?? 1}・${COMPARISON_LABEL[comparisonKind(r)]})`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const fmt = (n: number | undefined, d = 1) => (n === undefined ? '-' : n.toFixed(d));
  if (!groups.size) return <p className="note">結果がありません。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>モデル</th><th>回数</th><th>失敗</th><th>重大問題</th>{OVERALL_RATINGS.map((o) => <th key={o}>{o}</th>)}<th>未評価</th><th>詳細評価の合計点(平均)</th>
            {CRITERIA.map((c) => <th key={c.key}>{c.label}</th>)}
            <th>確定の不合格</th><th>要確認</th><th>応答(秒)</th><th>1回の費用</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([name, rs]) => {
            const m = summarize(rs);
            return (
              <tr key={name} className={m.serious ? 'serious-row' : ''}>
                <td>{name}</td><td>{m.runs}</td><td>{m.failed}</td>
                <td>{m.serious ? `⚠ ${m.serious}件` : '0'}{m.seriousUnjudged ? `(未判断${m.seriousUnjudged})` : ''}</td>
                {m.ratings.map((n, i) => <td key={i}>{n}</td>)}<td>{m.unrated}</td>
                <td>{fmt(m.avgTotal)}{m.scoredCount ? `(${m.scoredCount}件)` : ''}</td>
                {m.perCriterion.map((v, i) => <td key={i}>{fmt(v)}</td>)}
                <td>{m.mechFails} / {m.mechTotal}</td><td>{m.warns}</td>
                <td>{m.avgLatency === undefined ? '-' : (m.avgLatency / 1000).toFixed(1)}</td>
                <td>{m.avgCost === undefined ? '-' : yenPrecise(m.avgCost)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultsTab({ results, onSave, onClear }: { results: RunResult[]; onSave: (r: RunResult) => Promise<void>; onClear: () => Promise<void> }) {
  const [modelFilter, setModelFilter] = useState('');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = results.filter((r) => (!modelFilter || r.modelKey === modelFilter) && (!scenarioFilter || r.scenarioId === scenarioFilter));

  return (
    <section>
      <h2>モデル別の比較(通常の評価)</h2>
      <CompareTable results={results.filter((r) => r.track === 'standard')} />
      <p className="note">
        ◎○△×は、簡易評価の件数です(成功した結果のみ。未評価は別に数えます)。重大問題は、簡易評価で「あり」にしたもの、または詳細評価で記録したものの件数です。
        詳細評価の合計点は、6項目すべてを採点した結果だけで平均します(使っていない結果は入りません)。
        共通条件と実運用(max_tokens など個別設定あり)は、別の行に分けています。同じ条件で得た成績として比べないでください。
        自動検査は補助です。確定の不合格と要確認の数だけで、順位を決めないでください。模擬の結果も含まれるので、比べるときは絞り込んでください。
      </p>
      <h2>追加検証(耐性テスト)</h2>
      <CompareTable results={results.filter((r) => r.track === 'stress')} />
      <p className="note">B2 は、あえて他人の秘密を渡す耐性テストです。通常の評価とは混ぜずに見てください。</p>
      <h2>対照テスト(購入の話題を含まない履歴)</h2>
      <CompareTable results={results.filter((r) => r.track === 'control')} />
      <p className="note">B1N・B2N は、B1・B2 と同じ質問・同じ判定で、会話履歴からカモミールの購入の話題を除いたものです。B1・B2 との差で、履歴の影響を見ます。</p>

      <h2>実通信の回数(指示文v2・成功のみ)</h2>
      <CountTable results={results} />

      <div className="row wrap">
        <button disabled={!results.length} onClick={() => download(`ai-lab-results-${Date.now()}.json`, toJson(results, Date.now()), 'application/json')}>JSONで書き出す</button>
        <button disabled={!results.length} onClick={() => download(`ai-lab-results-${Date.now()}.csv`, toCsv(results), 'text/csv')}>CSVで書き出す</button>
        <button disabled={!results.length} onClick={() => { if (confirm('すべての結果と評価を消します。先に書き出しておくことをおすすめします。消しますか？')) void onClear(); }}>結果をすべて消す</button>
      </div>

      <h2>結果の一覧</h2>
      <div className="row wrap">
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
          <option value="">すべてのモデル</option>
          {models.map((m) => <option key={m.key} value={m.key}>{m.displayName}</option>)}
        </select>
        <select value={scenarioFilter} onChange={(e) => setScenarioFilter(e.target.value)}>
          <option value="">すべてのシナリオ</option>
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      {shown.length === 0 && <p className="note">まだ結果がありません。</p>}
      <ul className="result-list">
        {shown.map((r) => {
          const serious = hasSerious(r);
          const score = totalScore(r);
          return (
            <li key={r.id}>
              <button className={`row-btn ${serious ? 'serious' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                {serious ? '⚠ 重大問題 ・ ' : ''}
                {r.scenarioId}{r.track === 'stress' ? '(耐性)' : r.track === 'control' ? '(対照)' : ''} ・ {r.modelName} ・ {r.repeat}回目 ・ {{ success: '成功', error: '失敗', aborted: '停止' }[r.status]}
                {' ・ '}
                {r.quick?.overall ?? '未評価'}{score !== undefined ? `(詳細${score}点)` : ''}
                {r.checks.some((c) => c.basis === 'mechanical' && c.outcome === 'fail') ? ' ・ 確定の不合格あり' : ''}
              </button>
              {open === r.id && <ResultCard result={r} onSave={onSave} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CostTable({ m, p }: { m: ModelInfo; p: Omit<Parameters<typeof monthlyCost>[1], 'calls'> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>想定</th><th>回数/月</th><th>合計</th><th>入力</th><th>出力</th><th>再生成・追加</th><th>月額契約</th><th>クレジット</th></tr>
        </thead>
        <tbody>
          {USAGE_LEVELS.map((u) => {
            const c = monthlyCost(m, { ...p, calls: u.perDay * 30 });
            return (
              <tr key={u.label} className={c.known && c.totalJpy > 5000 ? 'over' : ''}>
                <td>{u.label}</td><td>{(u.perDay * 30).toLocaleString()}</td>
                <td><b>{c.known ? yen(c.totalJpy) : `${yen(c.feeJpy)}+従量(不明)`}</b></td>
                <td>{c.known ? yen(c.inputJpy) : '不明'}</td><td>{c.known ? yen(c.outputJpy) : '不明'}</td>
                <td>{c.known ? yen(c.regenJpy + c.extraJpy) : '不明'}</td>
                <td>{c.feeJpy ? yen(c.feeJpy) : '-'}</td><td>{c.creditJpy ? `−${yen(c.creditJpy)}` : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CostTab({ rate, setRate, results }: { rate: number; setRate: (n: number) => void; results: RunResult[] }) {
  const [inTok, setInTok] = useState(6000);
  const [outTok, setOutTok] = useState(800);
  const [regen, setRegen] = useState(10);
  const [extra, setExtra] = useState(0);
  const real = models.filter((m) => m.adapter !== 'mock-good' && m.adapter !== 'mock-bad');
  const num = (v: string, f: (n: number) => void) => f(Math.max(0, Number(v) || 0));
  const base = { regenRate: regen / 100, extraRate: extra / 100, rate };

  return (
    <section>
      <h2>月額の試算(30日間)</h2>
      <div className="grid2">
        <label className="field">1回の入力トークン<input type="number" value={inTok} onChange={(e) => num(e.target.value, setInTok)} /></label>
        <label className="field">1回の出力トークン<input type="number" value={outTok} onChange={(e) => num(e.target.value, setOutTok)} /></label>
        <label className="field">再生成の割合(%)<input type="number" value={regen} onChange={(e) => num(e.target.value, setRegen)} /></label>
        <label className="field">要約などの追加処理(%)<input type="number" value={extra} onChange={(e) => num(e.target.value, setExtra)} /></label>
        <label className="field">換算レート(円/米ドル)<input type="number" value={rate} onChange={(e) => num(e.target.value, setRate)} /></label>
      </div>
      <p className="note">
        {RATE_NOTE} 入力6,000・出力800トークンは実測ではなく仮定です。出力トークンは推論(考える処理)を含む数として計算し、推論を別に足すことはしません(二重に数えないため)。
        推定費用と実際の請求額は一致するとは限りません。画像生成の費用は含みません。目安の予算は月3,000〜5,000円です。
      </p>
      {real.map((m) => {
        const measured = measuredUsage(results, m.key);
        return (
          <div key={m.key} className="card">
            <strong>{m.displayName}</strong>
            {!priceKnown(m) && !m.monthlyFeeUsd ? (
              <p className="note">料金が確認できていないため、計算できません。</p>
            ) : (
              <>
                <p className="meta">仮定の値(入力{inTok}・出力{outTok}トークン)で計算</p>
                <CostTable m={m} p={{ ...base, inputTokens: inTok, outputTokens: outTok }} />
                {measured && (
                  <>
                    <p className="meta">
                      実測の平均で計算(実通信・APIの値・通常の評価 {measured.count}件: 入力{measured.inputTokens}・出力{measured.outputTokens}トークン
                      {measured.reasoningTokens !== undefined ? `、うち推論${measured.reasoningTokens}` : ''})
                    </p>
                    <CostTable m={m} p={{ ...base, inputTokens: measured.inputTokens, outputTokens: measured.outputTokens }} />
                  </>
                )}
              </>
            )}
            <p className="meta">
              単価: 入力 {m.priceInputUsdPerM ?? '?'} / 出力 {m.priceOutputUsdPerM ?? '?'} 米ドル(100万トークンあたり)
              {m.monthlyFeeUsd ? ` ・ 月額 $${m.monthlyFeeUsd}` : ''}
              {m.priceCheckedAt ? ` ・ 確認日 ${m.priceCheckedAt}` : ''}
              {m.priceSource ? ` ・ 出典 ${m.priceSource}` : ''}
            </p>
          </div>
        );
      })}
    </section>
  );
}

function ModelsTab() {
  const rows: [keyof ModelInfo, string][] = [
    ['provider', '提供元'], ['apiModelId', 'APIモデルID'], ['contextTokens', '最大入力(トークン)'], ['maxOutputTokens', '最大出力(トークン)'],
    ['reasoning', '推論(考える処理)'], ['japanese', '日本語'], ['structuredOutput', 'JSON・関数呼び出し'], ['streaming', '逐次表示'], ['contract', '契約・支払い'],
    ['adultTerms', '成人向けフィクションの利用条件(採点とは別)'], ['dataPolicy', 'データの扱い'], ['notes', 'メモ'], ['checkedAt', '確認日'],
  ];
  return (
    <section>
      <p className="note">2026年10月20日の調査結果です。多くの公式ページはこの環境から直接開けず、検索結果の抜粋や二次情報を含みます。使う前に各公式ページで確認してください。</p>
      <p className="note">生成設定は全モデル共通({JSON.stringify(GENERATION_PARAMS)})ですが、モデルが対応しない設定は送りません。対応が分からない設定は「未確認」として、そのまま送ります。設定の違いは比較結果に影響することがあります。</p>
      {models.map((m) => {
        const ep = m.endpointId ? ENDPOINTS[m.endpointId] : undefined;
        return (
          <div key={m.key} className="card">
            <header className="card-head"><strong>{m.displayName}</strong><span className="badge">{m.status}</span></header>
            <dl className="info">
              {rows.map(([k, label]) => (m[k] !== undefined ? <div key={k}><dt>{label}</dt><dd>{String(m[k])}</dd></div> : null))}
              {ep && <div><dt>送信先</dt><dd>{ep.url}(ブラウザから直接: {ep.browserDirect})</dd></div>}
              {m.params && <div><dt>生成設定への対応</dt><dd>temperature: {m.params.temperature} / max_tokens: {m.params.max_tokens}</dd></div>}
              {m.paramOverrides && <div><dt>モデル固有の調整</dt><dd>{JSON.stringify(m.paramOverrides.values)}: {m.paramOverrides.reason}</dd></div>}
              <div><dt>料金(100万トークン)</dt><dd>{priceKnown(m) ? `入力 $${m.priceInputUsdPerM} / 出力 $${m.priceOutputUsdPerM}${m.priceCheckedAt ? `(${m.priceCheckedAt}確認)` : ''}` : '未確認'}</dd></div>
              {m.priceSource && <div><dt>料金の出典</dt><dd>{m.priceSource}</dd></div>}
            </dl>
            {m.sources && (
              <details><summary>出典</summary><ul className="plain">{m.sources.map((s) => <li key={s}><a href={s} target="_blank" rel="noreferrer">{s}</a></li>)}</ul></details>
            )}
          </div>
        );
      })}
    </section>
  );
}

function SettingsTab({ keys, verified, setVerified }: { keys: Keys; verified: Set<string>; setVerified: (s: Set<string>) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState('');
  return (
    <section>
      <h2>安全についての注意</h2>
      <ul className="plain note">
        <li>・このページは GitHub Pages で公開されています。検索に出ない設定(noindex)はありますが、アクセス制限ではありません。URLを知っている人は開けます。</li>
        <li>・APIキーは保存しません。入力したキーは、この画面を開いている間だけメモリに置き、再読み込み・タブを閉じる・15分経過・「破棄」で消えます。</li>
        <li>・それでも、ブラウザの中でキーを扱う方式は完全に安全ではありません(拡張機能や、端末を触れる人などから見られる可能性があります)。本格的に使うときは、認証付きの中継サーバーを別に検討します。</li>
        <li>・キーを他人に見せたり、スクリーンショットに写したりしないでください。会社のPCでは入力しないでください。</li>
        <li>・送信できるのは、下の許可リストの送信先だけです。キーは、そのキーの送信先以外には送りません。</li>
        <li>・実通信の前に、送信先がブラウザから直接接続できるか(下の接続確認)と、利用規約を確認してください。</li>
      </ul>

      <h2>送信先とAPIキー</h2>
      {Object.values(ENDPOINTS).map((ep) => {
        const ok = ep.browserDirect === '確認済み' || verified.has(ep.id);
        return (
          <div key={ep.id} className="card">
            <strong>{ep.provider}</strong>
            <p className="meta">送信先: {ep.url}<br />{ep.note}</p>
            <p className="meta">
              ブラウザから直接接続: {ok ? '確認済み' : ep.browserDirect}
              {!ok && '(未確認のあいだ、実通信は無効)'}
            </p>
            <button
              disabled={checking === ep.id}
              onClick={async () => {
                setChecking(ep.id);
                const r = await checkBrowserAccess(ep);
                setChecking('');
                setMsg({ ...msg, [ep.id]: r.detail });
                if (r.ok) setVerified(new Set([...verified, ep.id]));
              }}
            >
              {checking === ep.id ? '確認中…' : '接続確認(無料・キーと会話は送らない)'}
            </button>
            <p className="note">接続確認では、本物のキーも会話も送らず、中身のない要求を1回だけ送ります。結果はこの画面を閉じると消えます。</p>
            <div className="row">
              <input
                className="secret"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={keys.present.includes(ep.id) ? '入力済み(表示しません)' : 'APIキーを貼り付け'}
                value={drafts[ep.id] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [ep.id]: e.target.value })}
              />
              <button
                disabled={!(drafts[ep.id] ?? '').trim()}
                onClick={() => {
                  keys.set(ep.id, drafts[ep.id]);
                  setDrafts({ ...drafts, [ep.id]: '' });
                  setMsg({ ...msg, [ep.id]: 'キーを一時的に使える状態にしました(保存はしていません。15分で自動的に消えます)' });
                }}
              >
                使う
              </button>
              <button disabled={!keys.present.includes(ep.id)} onClick={() => { keys.discard(ep.id); setMsg({ ...msg, [ep.id]: 'キーを破棄しました' }); }}>
                破棄
              </button>
            </div>
            <p className="meta">キー: {keys.present.includes(ep.id) ? '一時的に入力済み' : 'なし'}</p>
            {msg[ep.id] && <p className="note">{msg[ep.id]}</p>}
          </div>
        );
      })}
      <button disabled={!keys.present.length} onClick={keys.discardAll}>すべてのキーを破棄</button>
    </section>
  );
}
