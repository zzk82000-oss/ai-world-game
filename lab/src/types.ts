// 比較テスト環境(lab)の型。ゲーム本体とは独立している。
import type { Change, GameState } from '../../src/game/state';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Npc = {
  name: string;
  age: number;
  role: string;
  personality: string;
  speech: string;
  likes: string[];
  dislikes: string[];
  values: string[];
  routine: string;
  secret?: string; // 本人だけが知っている秘密。プロフィールの一部として本人のAIにだけ渡す
};

export type HistoryTurn = { player: string; reply: string };

export type CheckRule =
  | { kind: 'mustNotInclude'; words: string[]; label: string; severity: 'fail' | 'warn'; target?: 'all' | 'speech' }
  | { kind: 'mustIncludeAny'; words: string[]; label: string; severity: 'fail' | 'warn' }
  | { kind: 'noMoneyChange'; label: string }
  | { kind: 'paymentWithinFunds'; label: string; expectedPrice?: number };

export type Scenario = {
  id: string;
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  title: string;
  purpose: string;
  checks: string[]; // 人が確認する観点(指示書の確認事項)
  npcs: string[]; // 場面にいるNPC(このNPCの設定だけを渡す)
  relationship: string;
  extraContext: string[]; // 場面に関係する記憶・事実(誰が知っているかを明記)
  history: HistoryTurn[];
  playerInput: string;
  state: GameState;
  rules: CheckRule[];
};

export type ModelStatus = '確認済み' | '一部確認' | '未確認' | '提供終了' | '利用不可';

export type ModelInfo = {
  key: string; // このアプリ内での識別子
  displayName: string;
  provider: string; // 提供元(API の窓口)
  adapter: 'mock-good' | 'mock-bad' | 'openai' | 'none';
  baseUrl?: string;
  apiModelId?: string;
  status: ModelStatus;
  priceInputUsdPerM?: number;
  priceOutputUsdPerM?: number;
  monthlyFeeUsd?: number; // API利用に必要な月額(ない場合は空)
  includedCreditUsd?: number; // 月額などに含まれるクレジット
  contextTokens?: number;
  maxOutputTokens?: number;
  japanese?: string;
  structuredOutput?: string;
  streaming?: string;
  contract?: string;
  adultTerms?: string; // 成人向けフィクションに関する利用条件(採点とは別に扱う)
  dataPolicy?: string;
  notes?: string;
  sources?: string[];
  checkedAt?: string;
};

export type CheckResult = { label: string; outcome: 'pass' | 'warn' | 'fail' | 'skip'; detail: string };

export type ParsedOutput = {
  blocks: ({ type: 'narration'; text: string } | { type: 'speech'; speaker: string; text: string })[];
  changes: Change[] | null; // null = 形式どおりの変更案が見つからない
  promises: { who?: string; what?: string; when?: string }[];
  formatError?: string;
};

export const CRITERIA = [
  { key: 'japanese', label: '日本語の自然さ', max: 20 },
  { key: 'persona', label: 'NPC人格の一貫性', max: 20 },
  { key: 'relationship', label: '関係性の自然な進展', max: 20 },
  { key: 'knowledge', label: '秘密・知識・記憶の遵守', max: 15 },
  { key: 'freedom', label: 'プレイヤーの自由の尊重', max: 15 },
  { key: 'state', label: 'ゲーム状態との連携', max: 10 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]['key'];

export type Evaluation = {
  scores: Partial<Record<CriterionKey, number>>;
  reasons: Partial<Record<CriterionKey, string>>;
  problemExample: string;
  comment: string;
  updatedAt: number;
};

export type RunResult = {
  id: string;
  createdAt: number;
  modelKey: string;
  modelName: string;
  apiModelId?: string;
  provider: string;
  live: boolean; // 実通信か(false = 模擬)
  scenarioId: string;
  repeat: number;
  status: 'success' | 'error' | 'aborted';
  error?: string;
  request: { messages: ChatMessage[]; params: Record<string, unknown> };
  output: string;
  parsed?: ParsedOutput;
  checks: CheckResult[];
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; estimated: boolean };
  costJpy?: number;
  evaluation?: Evaluation;
};
