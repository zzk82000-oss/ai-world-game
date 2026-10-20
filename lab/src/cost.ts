// 費用の推定。実際の請求額と一致するとは限らない。
import type { ModelInfo } from './types';

export const DEFAULT_RATE = 160; // 指示書の暫定換算レート(1米ドル=160円)。実勢レートではない
export const RATE_NOTE = '1米ドル=160円(指示書の暫定値・2026年10月20日設定)。実勢レートとは異なります。';

export const USAGE_LEVELS = [
  { label: '実績に近い利用量', perDay: 80 },
  { label: '標準', perDay: 100 },
  { label: '多め', perDay: 150 },
  { label: '高頻度', perDay: 200 },
];

// トークン数の目安。日本語は1文字≒1トークン、それ以外は4文字≒1トークンとして概算する(モデルごとに違う)
export function estimateTokens(text: string): number {
  const ja = text.match(/[぀-ヿ㐀-鿿＀-￯]/g)?.length ?? 0;
  return Math.ceil(ja + (text.length - ja) / 4);
}

export const priceKnown = (m: ModelInfo) => m.priceInputUsdPerM !== undefined && m.priceOutputUsdPerM !== undefined;

export function callCostUsd(m: ModelInfo, inputTokens: number, outputTokens: number): number | undefined {
  if (!priceKnown(m)) return undefined;
  return (inputTokens * (m.priceInputUsdPerM as number) + outputTokens * (m.priceOutputUsdPerM as number)) / 1_000_000;
}

export type MonthlyParams = {
  calls: number; // 30日間の回数
  inputTokens: number;
  outputTokens: number;
  regenRate: number; // 再生成の割合(0.1 = 10回に1回)
  extraRate: number; // 要約などの追加AI処理(本体の何割か)
  rate: number;
};

export type MonthlyCost = {
  known: boolean;
  inputJpy: number;
  outputJpy: number;
  regenJpy: number;
  extraJpy: number;
  feeJpy: number;
  creditJpy: number;
  usageJpy: number; // 従量課金の実費(クレジット差し引き後)
  totalJpy: number;
};

export function monthlyCost(m: ModelInfo, p: MonthlyParams): MonthlyCost {
  const known = priceKnown(m);
  const inputJpy = known ? ((p.calls * p.inputTokens * (m.priceInputUsdPerM as number)) / 1_000_000) * p.rate : 0;
  const outputJpy = known ? ((p.calls * p.outputTokens * (m.priceOutputUsdPerM as number)) / 1_000_000) * p.rate : 0;
  const base = inputJpy + outputJpy;
  const regenJpy = base * p.regenRate;
  const extraJpy = base * p.extraRate;
  const feeJpy = (m.monthlyFeeUsd ?? 0) * p.rate;
  const creditJpy = Math.min((m.includedCreditUsd ?? 0) * p.rate, base + regenJpy + extraJpy);
  const usageJpy = base + regenJpy + extraJpy - creditJpy;
  return { known, inputJpy, outputJpy, regenJpy, extraJpy, feeJpy, creditJpy, usageJpy, totalJpy: usageJpy + feeJpy };
}

export const yen = (n: number) => `${Math.round(n).toLocaleString('ja-JP')}円`;
export const yenPrecise = (n: number) => (n < 10 ? `${n.toFixed(2)}円` : yen(n));
