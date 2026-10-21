// 結果の書き出し(JSON・CSV)。APIキーは含めない(結果にはそもそも保存していない)。
import { FIXTURE_VERSION } from './data/fixture';
import { CRITERIA, MISMATCHES, PROBLEM_TYPES, SERIOUS_ISSUES, type RunResult } from './types';

export function toJson(results: RunResult[], exportedAt: number): string {
  return JSON.stringify({ app: 'ai-world-game-lab', kind: 'results', fixtureVersion: FIXTURE_VERSION, exportedAt, results }, null, 2);
}

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function totalScore(r: RunResult): number | undefined {
  const s = r.evaluation?.scores;
  if (!s) return undefined;
  const vals = CRITERIA.map((c) => s[c.key]);
  return vals.every((v) => typeof v === 'number') ? (vals as number[]).reduce((a, b) => a + b, 0) : undefined;
}

export const seriousLabels = (r: RunResult) =>
  SERIOUS_ISSUES.filter((s) => r.evaluation?.serious?.[s.key] !== undefined).map((s) => {
    const note = r.evaluation?.serious?.[s.key];
    return note ? `${s.label}(${note})` : s.label;
  });

// 比較の区分。実際に送った設定が共通の指定値と違うもの(max_tokens の変更、非対応の設定を送らなかった等)は「実運用比較」、同じなら「共通条件比較」。
// 2つの結果を同じ条件で得た成績として集計しない。
export type ComparisonKind = 'common' | 'practical';
export const COMPARISON_LABEL: Record<ComparisonKind, string> = { common: '共通条件', practical: '実運用(個別設定あり)' };

export function comparisonKind(r: RunResult): ComparisonKind {
  const req = r.request.requestedParams;
  const sent = r.request.sentParams;
  const same = Object.keys(req).every((k) => JSON.stringify(req[k]) === JSON.stringify(sent[k]));
  return same ? 'common' : 'practical';
}

export const problemLabels = (r: RunResult) => PROBLEM_TYPES.filter((p) => r.quick?.problems.includes(p.key)).map((p) => p.label);

// 重大問題があるか(詳細評価での記録、または簡易評価で「あり」)
export const hasSerious = (r: RunResult) => seriousLabels(r).length > 0 || r.quick?.serious === 'yes';

const ZDR_LABEL = { on: 'オン', off: 'オフ', unknown: '未確認' } as const;

export function toCsv(results: RunResult[]): string {
  const head = [
    '日時', 'モデル', 'APIモデルID', '送信先', '処理した提供元', '指定した提供元', '実通信', 'シナリオ', '区分', '比較の区分', '指示文の版', '回', '状態', '応答時間(ミリ秒)',
    '入力トークン', '出力トークン(推論を含む)', '推論トークン(内訳)', '使用量の出どころ', '単価(入力/出力 $/100万)', '単価の確認日', '推定費用(円・請求額は未確認)',
    '送った生成設定', '設定の注記', '自動検査(確定・不合格)', '自動検査(疑い・要確認)', ...CRITERIA.map((c) => `${c.label}(${c.max})`), '合計(100)',
    '重大問題', 'コメント', '問題のあった出力例',
    '簡易評価(総合)', '簡易評価(問題の種類)', '簡易評価(重大問題)', '簡易評価(本文と提案の食い違い)', '簡易評価(コメント)', 'ZDR(入力値)', '規約確認などのメモ', '出力',
  ];
  const rows = results.map((r) => [
    new Date(r.createdAt).toISOString(), r.modelName, r.apiModelId, r.endpoint, r.servedBy, r.pinnedProvider, r.live ? 'はい' : 'いいえ(模擬)', r.scenarioId,
    { standard: '通常', stress: '耐性テスト(追加検証)', control: '対照テスト', induce: '誘発テスト(購入以外)' }[r.track], COMPARISON_LABEL[comparisonKind(r)], `v${r.promptVersion ?? 1}`, r.repeat, r.status, r.latencyMs,
    r.usage.inputTokens, r.usage.outputTokens, r.usage.reasoningTokens, r.usage.source === 'api' ? 'APIの値' : '概算',
    r.price ? `${r.price.inputUsdPerM}/${r.price.outputUsdPerM}` : '未確認', r.price?.checkedAt, r.costJpy?.toFixed(3),
    JSON.stringify(r.request.sentParams), r.request.paramNotes.join(' / '),
    r.checks.filter((c) => c.basis === 'mechanical' && c.outcome === 'fail').length, r.checks.filter((c) => c.outcome === 'warn').length,
    ...CRITERIA.map((c) => r.evaluation?.scores[c.key]), totalScore(r), seriousLabels(r).join(' / '), r.evaluation?.comment, r.evaluation?.problemExample,
    r.quick?.overall ?? '未評価', problemLabels(r).join(' / '), r.quick ? { yes: 'あり', no: 'なし', unknown: '未判断' }[r.quick.serious] : '未評価',
    MISMATCHES.filter((m) => r.quick?.mismatch?.includes(m.key)).map((m) => m.label).join(' / '), r.quick?.comment,
    r.env ? ZDR_LABEL[r.env.zdr] : '未記録', r.env?.note, r.output,
  ]);
  // 先頭の BOM は、Excel で開いたときの文字化けを防ぐため
  return '﻿' + [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
