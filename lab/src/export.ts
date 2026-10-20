// 結果の書き出し(JSON・CSV)。APIキーは含めない(結果にはそもそも保存していない)。
import { FIXTURE_VERSION } from './data/fixture';
import { CRITERIA, type RunResult } from './types';

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

export function toCsv(results: RunResult[]): string {
  const head = [
    '日時', 'モデル', 'APIモデルID', '実通信', 'シナリオ', '回', '状態', '応答時間(ミリ秒)', '入力トークン', '出力トークン', 'トークンは推定', '推定費用(円)',
    '自動検査(不合格)', '自動検査(要確認)', ...CRITERIA.map((c) => `${c.label}(${c.max})`), '合計(100)', 'コメント', '問題のあった出力例', '出力',
  ];
  const rows = results.map((r) => [
    new Date(r.createdAt).toISOString(), r.modelName, r.apiModelId, r.live ? 'はい' : 'いいえ(模擬)', r.scenarioId, r.repeat, r.status,
    r.latencyMs, r.usage.inputTokens, r.usage.outputTokens, r.usage.estimated ? 'はい' : 'いいえ', r.costJpy?.toFixed(3),
    r.checks.filter((c) => c.outcome === 'fail').length, r.checks.filter((c) => c.outcome === 'warn').length,
    ...CRITERIA.map((c) => r.evaluation?.scores[c.key]), totalScore(r), r.evaluation?.comment, r.evaluation?.problemExample, r.output,
  ]);
  // 先頭の BOM は、Excel で開いたときの文字化けを防ぐため
  return '﻿' + [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
