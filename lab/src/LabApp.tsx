import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_RATE, estimateTokens, monthlyCost, priceKnown, RATE_NOTE, USAGE_LEVELS, yen, yenPrecise, callCostUsd } from './cost';
import { scenarioById, scenarios } from './data/scenarios';
import { toCsv, toJson, totalScore } from './export';
import { modelByKey, models, providersNeedingKey } from './models';
import { buildMessages, GENERATION_PARAMS } from './prompt';
import { estimateInputTokens } from './providers';
import { ResultCard } from './ResultCard';
import { runOne } from './runner';
import { LabStore } from './store';
import { CRITERIA, type RunResult } from './types';

type Tab = 'run' | 'results' | 'cost' | 'models' | 'settings';
const TABS: [Tab, string][] = [['run', '実行'], ['results', '結果'], ['cost', '費用'], ['models', 'モデル'], ['settings', '設定']];

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LabApp() {
  const [tab, setTab] = useState<Tab>('run');
  const [store, setStore] = useState<LabStore | null>(null);
  const [storeError, setStoreError] = useState('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [keyProviders, setKeyProviders] = useState<string[]>([]);
  const [rate, setRate] = useState(DEFAULT_RATE);

  useEffect(() => {
    LabStore.open()
      .then(async (s) => {
        setStore(s);
        setResults(await s.listResults());
        setKeyProviders(await s.listKeyProviders());
      })
      .catch(() => setStoreError('この端末のブラウザでは保存できません。結果は保存されません。'));
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
        {storeError && <p className="error">{storeError}</p>}
      </header>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'run' && <RunTab store={store} keyProviders={keyProviders} rate={rate} onResult={saveResult} />}
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
        {tab === 'cost' && <CostTab rate={rate} setRate={setRate} />}
        {tab === 'models' && <ModelsTab />}
        {tab === 'settings' && <SettingsTab store={store} keyProviders={keyProviders} setKeyProviders={setKeyProviders} />}
      </main>
    </div>
  );
}

function RunTab({ store, keyProviders, rate, onResult }: { store: LabStore | null; keyProviders: string[]; rate: number; onResult: (r: RunResult) => Promise<void> }) {
  const [modelKey, setModelKey] = useState('mock-good');
  const [scenarioId, setScenarioId] = useState('A');
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [last, setLast] = useState<RunResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const model = modelByKey(modelKey)!;
  const scenario = scenarioById(scenarioId)!;
  const messages = useMemo(() => buildMessages(scenario), [scenario]);
  const inTok = estimateInputTokens(messages);
  const estUsd = callCostUsd(model, inTok, GENERATION_PARAMS.max_tokens);
  const isLive = model.adapter === 'openai';
  const hasKey = keyProviders.includes(model.provider);
  const runnable = model.adapter !== 'none' && (!isLive || hasKey);

  const run = async (targets: { id: string; repeat: number }[]) => {
    const ac = new AbortController();
    abortRef.current = ac;
    const apiKey = isLive && store ? await store.getKey(model.provider) : undefined;
    const done: RunResult[] = [];
    for (const [i, t] of targets.entries()) {
      if (ac.signal.aborted) break;
      setBusy(`${i + 1} / ${targets.length} を実行中…`);
      const r = await runOne(model, scenarioById(t.id)!, { repeat: t.repeat, apiKey, signal: ac.signal, rate });
      await onResult(r);
      done.push(r);
      setLast([...done].reverse());
    }
    setBusy('');
    abortRef.current = null;
  };

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
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>

      <div className="card">
        <p>{scenario.purpose}</p>
        <p className="meta">プレイヤーの入力: {scenario.playerInput}</p>
        <ul className="plain">
          {scenario.checks.map((c) => (
            <li key={c}>・{c}</li>
          ))}
        </ul>
        <details>
          <summary>モデルに送る内容を見る(約{inTok.toLocaleString()}トークン)</summary>
          {messages.map((m, i) => (
            <pre key={i} className={`msg ${m.role}`}>
              <b>{{ system: '設定', user: 'プレイヤー', assistant: '過去の返答' }[m.role]}</b>
              {'\n'}
              {m.content}
            </pre>
          ))}
          <p className="meta">生成設定: {JSON.stringify(GENERATION_PARAMS)}(全モデル共通)</p>
        </details>
      </div>

      {model.adapter === 'none' && <p className="error">このモデルは接続方法・利用条件が確認できていないため、実行できません(「モデル」タブ参照)。</p>}
      {isLive && !hasKey && <p className="error">{model.provider} のAPIキーが未登録です。「設定」タブで登録すると実行できます。</p>}

      {busy ? (
        <div className="row">
          <span>{busy}</span>
          <button onClick={() => abortRef.current?.abort()}>停止</button>
        </div>
      ) : !isLive ? (
        <div className="row wrap">
          <button disabled={!runnable} onClick={() => run([{ id: scenarioId, repeat: 1 }])}>
            模擬で実行
          </button>
          <button disabled={!runnable} onClick={() => run(scenarios.flatMap((s) => [1, 2, 3].map((repeat) => ({ id: s.id, repeat }))))}>
            第1段階を一括(全シナリオ×3回・模擬のみ)
          </button>
        </div>
      ) : !confirming ? (
        <button disabled={!runnable} onClick={() => { setConfirming(true); setAgreed(false); }}>
          送信内容と費用を確認する
        </button>
      ) : (
        <div className="card confirm">
          <h3>実際に送信する前の確認</h3>
          <ul className="plain">
            <li>送信先: {model.provider}({model.baseUrl})</li>
            <li>モデルID: {model.apiModelId}</li>
            <li>送る内容: 上の「モデルに送る内容」(架空のテスト用データ)</li>
            <li>入力 約{inTok.toLocaleString()}トークン(推定)・出力 最大{GENERATION_PARAMS.max_tokens}トークン</li>
            <li>推定費用: 最大 {estUsd === undefined ? '料金未確認のため不明' : `${yenPrecise(estUsd * rate)}($${estUsd.toFixed(5)})`}</li>
            <li>送信は1回だけです。失敗しても自動で再試行しません。</li>
            <li>推定費用と実際の請求額は一致しないことがあります。</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> 内容と費用を確認しました
          </label>
          <div className="row">
            <button disabled={!agreed} onClick={() => { setConfirming(false); void run([{ id: scenarioId, repeat: 1 }]); }}>
              1回だけ送信する
            </button>
            <button onClick={() => setConfirming(false)}>やめる</button>
          </div>
        </div>
      )}

      {last.map((r) => (
        <ResultCard key={r.id} result={r} onSave={onResult} />
      ))}
    </section>
  );
}

function ResultsTab({ results, onSave, onClear }: { results: RunResult[]; onSave: (r: RunResult) => Promise<void>; onClear: () => Promise<void> }) {
  const [modelFilter, setModelFilter] = useState('');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = results.filter((r) => (!modelFilter || r.modelKey === modelFilter) && (!scenarioFilter || r.scenarioId === scenarioFilter));

  const byModel = useMemo(() => {
    const groups = new Map<string, RunResult[]>();
    for (const r of results) groups.set(r.modelName, [...(groups.get(r.modelName) ?? []), r]);
    return [...groups.entries()].map(([name, rs]) => {
      const ok = rs.filter((r) => r.status === 'success');
      const scored = ok.map(totalScore).filter((x): x is number => x !== undefined);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
      const perCriterion = CRITERIA.map((c) => avg(ok.map((r) => r.evaluation?.scores[c.key]).filter((x): x is number => typeof x === 'number')));
      const checks = ok.flatMap((r) => r.checks).filter((c) => c.outcome !== 'skip');
      return {
        name,
        runs: rs.length,
        failed: rs.length - ok.length,
        avgTotal: avg(scored),
        scoredCount: scored.length,
        perCriterion,
        passRate: checks.length ? checks.filter((c) => c.outcome === 'pass').length / checks.length : undefined,
        avgLatency: avg(ok.map((r) => r.latencyMs)),
        avgCost: avg(ok.map((r) => r.costJpy).filter((x): x is number => x !== undefined)),
      };
    });
  }, [results]);

  const fmt = (n: number | undefined, d = 1) => (n === undefined ? '-' : n.toFixed(d));

  return (
    <section>
      <h2>モデル別の比較</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>モデル</th><th>回数</th><th>失敗</th><th>合計点(平均)</th>
              {CRITERIA.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>自動検査の合格率</th><th>応答(秒)</th><th>1回の費用</th>
            </tr>
          </thead>
          <tbody>
            {byModel.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td><td>{m.runs}</td><td>{m.failed}</td>
                <td>{fmt(m.avgTotal)}{m.scoredCount ? `(${m.scoredCount}件)` : ''}</td>
                {m.perCriterion.map((v, i) => <td key={i}>{fmt(v)}</td>)}
                <td>{m.passRate === undefined ? '-' : `${Math.round(m.passRate * 100)}%`}</td>
                <td>{m.avgLatency === undefined ? '-' : (m.avgLatency / 1000).toFixed(1)}</td>
                <td>{m.avgCost === undefined ? '-' : yenPrecise(m.avgCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">合計点は、6項目すべてを採点した結果だけで平均します。模擬の結果も含まれるので、比べるときは絞り込んでください。</p>

      <div className="row wrap">
        <button disabled={!results.length} onClick={() => download(`ai-lab-results-${Date.now()}.json`, toJson(results, Date.now()), 'application/json')}>JSONで書き出す</button>
        <button disabled={!results.length} onClick={() => download(`ai-lab-results-${Date.now()}.csv`, toCsv(results), 'text/csv')}>CSVで書き出す</button>
        <button disabled={!results.length} onClick={() => { if (confirm('すべての結果と採点を消します。先に書き出しておくことをおすすめします。消しますか？')) void onClear(); }}>結果をすべて消す</button>
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
        {shown.map((r) => (
          <li key={r.id}>
            <button className="row-btn" onClick={() => setOpen(open === r.id ? null : r.id)}>
              {r.scenarioId} ・ {r.modelName} ・ {r.repeat}回目 ・ {{ success: '成功', error: '失敗', aborted: '停止' }[r.status]}
              {' ・ '}
              {totalScore(r) !== undefined ? `${totalScore(r)}点` : '未採点'}
              {r.checks.some((c) => c.outcome === 'fail') ? ' ・ 不合格あり' : ''}
            </button>
            {open === r.id && <ResultCard result={r} onSave={onSave} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CostTab({ rate, setRate }: { rate: number; setRate: (n: number) => void }) {
  const [inTok, setInTok] = useState(6000);
  const [outTok, setOutTok] = useState(800);
  const [regen, setRegen] = useState(10);
  const [extra, setExtra] = useState(0);
  const real = models.filter((m) => m.adapter !== 'mock-good' && m.adapter !== 'mock-bad');
  const num = (v: string, f: (n: number) => void) => f(Math.max(0, Number(v) || 0));

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
        {RATE_NOTE} 入力6,000・出力800トークンは実測ではなく仮定です。実際のゲームの会話履歴や記憶の量で変わります。
        推定費用と実際の請求額は一致するとは限りません。画像生成の費用は含みません。目安の予算は月3,000〜5,000円です。
      </p>
      {real.map((m) => (
        <div key={m.key} className="card">
          <strong>{m.displayName}</strong>
          {!priceKnown(m) && !m.monthlyFeeUsd ? (
            <p className="note">料金が確認できていないため、計算できません。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>想定</th><th>回数/月</th><th>合計</th><th>入力</th><th>出力</th><th>再生成・追加</th><th>月額契約</th><th>クレジット</th></tr>
                </thead>
                <tbody>
                  {USAGE_LEVELS.map((u) => {
                    const c = monthlyCost(m, { calls: u.perDay * 30, inputTokens: inTok, outputTokens: outTok, regenRate: regen / 100, extraRate: extra / 100, rate });
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
          )}
          <p className="meta">
            単価: 入力 {m.priceInputUsdPerM ?? '?'} / 出力 {m.priceOutputUsdPerM ?? '?'} 米ドル(100万トークンあたり)
            {m.monthlyFeeUsd ? ` ・ 月額 $${m.monthlyFeeUsd}` : ''}
          </p>
        </div>
      ))}
      <p className="note">1回あたりの出力 {outTok} トークンは、日本語でおよそ {Math.round(outTok)} 文字前後の目安です(モデルで変わります)。例文「{'こんにちは'}」= 約{estimateTokens('こんにちは')}トークン。</p>
    </section>
  );
}

function ModelsTab() {
  const rows: [keyof typeof models[number], string][] = [
    ['provider', '提供元'], ['apiModelId', 'APIモデルID'], ['baseUrl', '接続先'], ['contextTokens', '最大入力(トークン)'], ['maxOutputTokens', '最大出力(トークン)'],
    ['japanese', '日本語'], ['structuredOutput', 'JSON・関数呼び出し'], ['streaming', '逐次表示'], ['contract', '契約・支払い'],
    ['adultTerms', '成人向けフィクションの利用条件(採点とは別)'], ['dataPolicy', 'データの扱い'], ['notes', 'メモ'], ['checkedAt', '確認日'],
  ];
  return (
    <section>
      <p className="note">2026年10月20日の調査結果です。多くの公式ページはこの環境から直接開けず、検索結果の抜粋や二次情報を含みます。使う前に各公式ページで確認してください。</p>
      {models.map((m) => (
        <div key={m.key} className="card">
          <header className="card-head"><strong>{m.displayName}</strong><span className="badge">{m.status}</span></header>
          <dl className="info">
            {rows.map(([k, label]) => (m[k] !== undefined ? <div key={k}><dt>{label}</dt><dd>{String(m[k])}</dd></div> : null))}
            <div><dt>料金(100万トークン)</dt><dd>{priceKnown(m) ? `入力 $${m.priceInputUsdPerM} / 出力 $${m.priceOutputUsdPerM}` : '未確認'}</dd></div>
          </dl>
          {m.sources && (
            <details><summary>出典</summary><ul className="plain">{m.sources.map((s) => <li key={s}><a href={s} target="_blank" rel="noreferrer">{s}</a></li>)}</ul></details>
          )}
        </div>
      ))}
    </section>
  );
}

function SettingsTab({ store, keyProviders, setKeyProviders }: { store: LabStore | null; keyProviders: string[]; setKeyProviders: (p: string[]) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const refresh = async () => store && setKeyProviders(await store.listKeyProviders());
  return (
    <section>
      <h2>APIキー</h2>
      <p className="note">
        APIキーは、この端末のブラウザの中だけに保存します。ソースコード・GitHub・結果の書き出しには入りません。
        キーを他人に見せたり、スクリーンショットに写したりしないでください。会社のPCでは登録しないでください。
      </p>
      {providersNeedingKey().map((p) => (
        <div key={p} className="card">
          <strong>{p}</strong> {keyProviders.includes(p) ? <span className="badge success">登録済み</span> : <span className="badge">未登録</span>}
          <div className="row">
            <input type="password" autoComplete="off" placeholder="APIキーを貼り付け" value={drafts[p] ?? ''} onChange={(e) => setDrafts({ ...drafts, [p]: e.target.value })} />
            <button disabled={!store || !(drafts[p] ?? '').trim()} onClick={async () => { await store!.setKey(p, drafts[p]); setDrafts({ ...drafts, [p]: '' }); await refresh(); setMsg(`${p} のキーを保存しました`); }}>保存</button>
            <button disabled={!store || !keyProviders.includes(p)} onClick={async () => { await store!.deleteKey(p); await refresh(); setMsg(`${p} のキーを削除しました`); }}>削除</button>
          </div>
        </div>
      ))}
      {msg && <p className="note">{msg}</p>}
      <p className="note">キーを登録しても、自動で通信することはありません。実行タブで確認してから、1回ずつ送信します。</p>
    </section>
  );
}
