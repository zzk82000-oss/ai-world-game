// 結果の書き出し(JSON・CSV)。APIキーは含めない(結果にはそもそも保存していない)。
import { FIXTURE_VERSION } from './data/fixture';
import { CRITERIA, SERIOUS_ISSUES, type RunResult } from './types';

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

export function toCsv(results: RunResult[]): string {
  const head = [
    '日時', 'モデル', 'APIモデルID', '送信先', '実通信', 'シナリオ', '区分', '回', '状態', '応答時間(ミリ秒)',
    '入力トークン', '出力トークン(推論を含む)', '推論トークン(内訳)', '使用量の出どころ', '単価(入力/出力 $/100万)', '単価の確認日', '推定費用(円・請求額は未確認)',
    '送った生成設定', '設定の注記', '自動検査(確定・不合格)', '自動検査(疑い・要確認)', ...CRITERIA.map((c) => `${c.label}(${c.max})`), '合計(100)',
    '重大問題', 'コメント', '問題のあった出力例', '出力',
  ];
  const rows = results.map((r) => [
    new Date(r.createdAt).toISOString(), r.modelName, r.apiModelId, r.endpoint, r.live ? 'はい' : 'いいえ(模擬)', r.scenarioId,
    r.track === 'stress' ? '耐性テスト(追加検証)' : '通常', r.repeat, r.status, r.latencyMs,
    r.usage.inputTokens, r.usage.outputTokens, r.usage.reasoningTokens, r.usage.source === 'api' ? 'APIの値' : '概算',
    r.price ? `${r.price.inputUsdPerM}/${r.price.outputUsdPerM}` : '未確認', r.price?.checkedAt, r.costJpy?.toFixed(3),
    JSON.stringify(r.request.sentParams), r.request.paramNotes.join(' / '),
    r.checks.filter((c) => c.basis === 'mechanical' && c.outcome === 'fail').length, r.checks.filter((c) => c.outcome === 'warn').length,
    ...CRITERIA.map((c) => r.evaluation?.scores[c.key]), totalScore(r), seriousLabels(r).join(' / '), r.evaluation?.comment, r.evaluation?.problemExample, r.output,
  ]);
  // 先頭の BOM は、Excel で開いたときの文字化けを防ぐため
  return '﻿' + [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
