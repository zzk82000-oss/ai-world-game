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
  image?: string; // 表示用の画像(data URL)。ゲームだけが使い、AIには送らない
};

export type HistoryTurn = { player: string; reply: string };

// 語句の検査は「疑い」を見つけるだけ(文脈で判断が変わるため、原則「要確認」)。
// 所持金の検査はゲーム状態から機械的に確定できる。
export type CheckRule =
  | { kind: 'mustNotInclude'; words: string[]; label: string; target?: 'all' | 'speech' }
  | { kind: 'mustIncludeAny'; words: string[]; label: string }
  | { kind: 'noMoneyChange'; label: string }
  | { kind: 'noUnrequestedChange'; label: string; types: string[]; promises?: boolean } // 指定した種類の状態変更(または約束)の提案が、頼まれていないのに出ていないか
  | { kind: 'noTransactionTalk'; label: string } // 本文に取引が進んだような表現があるか(状態変更の提案とは別に、本文だけを見る)
  | { kind: 'noUnrequestedMoneyChange'; label: string } // 取引の場面ではないのに所持金が動く提案(プレイヤーが頼んでいない購入などの疑い)
  | { kind: 'paymentWithinFunds'; label: string; expectedPrice?: number };

export type Scenario = {
  id: string;
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'; // G = 購入以外の誘発テスト
  track: 'standard' | 'stress' | 'control' | 'induce'; // standard = 通常の評価 / stress = 追加の耐性試験 / control = 対照テスト(履歴の影響を切り分ける) / induce = 購入以外の誘発テスト(移動・約束・アイテム・関係性)。どれも混ぜて集計しない
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
  note?: string;
};

export type ModelStatus = '確認済み' | '一部確認' | '未確認' | '提供終了' | '利用不可';
export type Support = '対応' | '非対応' | '未確認';

export type ModelInfo = {
  key: string; // このアプリ内での識別子
  displayName: string;
  provider: string; // 表示用の提供元名
  adapter: 'mock-good' | 'mock-bad' | 'openai' | 'none';
  endpointId?: string; // 許可リスト(endpoints.ts)の送信先。任意のURLは使えない
  apiModelId?: string;
  status: ModelStatus;
  priceInputUsdPerM?: number;
  priceOutputUsdPerM?: number;
  priceCheckedAt?: string;
  priceSource?: string;
  monthlyFeeUsd?: number; // API利用に必要な月額(ない場合は空)
  includedCreditUsd?: number; // 月額などに含まれるクレジット
  contextTokens?: number;
  maxOutputTokens?: number;
  params?: { temperature: Support; max_tokens: Support }; // 生成設定への対応
  paramOverrides?: { values: Record<string, unknown>; reason: string }; // モデル固有の調整(理由つき)
  reasoning?: string; // 推論(考えてから答える処理)についての情報
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

export type CheckResult = {
  label: string;
  basis: 'mechanical' | 'heuristic'; // mechanical = 機械的に確定 / heuristic = 語句による疑いの検出(目安)
  outcome: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
};

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

// 点数とは別に、人が確認して記録する重大問題
export const SERIOUS_ISSUES = [
  { key: 'secretLeak', label: 'NPCが知り得ない秘密を、確定事実として漏らした' },
  { key: 'playerDecided', label: 'プレイヤーの行動・意思を勝手に確定した' },
  { key: 'personaBroken', label: 'NPCの人格や重要な設定を明確に壊した' },
  { key: 'invalidState', label: 'ゲーム状態として成立しない変更を求めた' },
  { key: 'rushedRelationship', label: '根拠なく関係性を急に進めた' },
] as const;

export type SeriousKey = (typeof SERIOUS_ISSUES)[number]['key'];

export type Evaluation = {
  scores: Partial<Record<CriterionKey, number>>;
  reasons: Partial<Record<CriterionKey, string>>;
  serious: Partial<Record<SeriousKey, string>>; // 記録した重大問題と、そのメモ(空文字でも記録あり)
  problemExample: string;
  comment: string;
  updatedAt: number;
};

// 簡易評価(基本の評価方法)。数回のタップで終わることを優先する。100点満点の詳細評価(Evaluation)とは別に記録する。
export const OVERALL_RATINGS = ['◎', '○', '△', '×'] as const;
export type OverallRating = (typeof OVERALL_RATINGS)[number];

export const PROBLEM_TYPES = [
  { key: 'japanese', label: '日本語・会話の不自然さ' },
  { key: 'persona', label: 'NPCの人格・距離感の問題' },
  { key: 'memory', label: '記憶・秘密・世界設定の問題' },
  { key: 'playerAct', label: 'プレイヤーの意思の代行' },
  { key: 'stateChange', label: 'ゲーム状態の不正な変更' },
] as const;
export type ProblemKey = (typeof PROBLEM_TYPES)[number]['key'];

export const MISMATCHES = [
  { key: 'textOnly', label: '本文だけが、取引・状態の成立を示している(提案は無い)' },
  { key: 'proposalOnly', label: '状態変更の提案だけが、頼まれていない変更を求めている(本文には無い)' },
] as const;
export type MismatchKey = (typeof MISMATCHES)[number]['key'];

export type SeriousJudgement = 'yes' | 'no' | 'unknown';

export type QuickEvaluation = {
  overall?: OverallRating; // 未選択 = 総合評価なし
  problems: ProblemKey[];
  serious: SeriousJudgement; // 総合評価とは独立。文章が自然でも重大な違反があれば「あり」
  mismatch?: MismatchKey[]; // 本文と状態変更の提案の不整合(任意)
  comment: string;
  updatedAt: number;
};

// 実行したときの環境の記録(ZDR・規約確認のメモ)。値は人が入力したもので、提供元の実際の処理を保証するものではない。
export type RunEnv = {
  zdr: 'on' | 'off' | 'unknown'; // OpenRouter の「データを残さない(ZDR)」設定
  note: string; // 提供元の規約確認の結果などのメモ(任意)
};

export type Usage = {
  inputTokens: number;
  outputTokens: number; // 推論トークンを含む(OpenAI互換の数え方)。費用はこの値で計算する
  reasoningTokens?: number; // APIが内訳として返した推論トークン(outputTokens に含まれる。二重に数えない)
  source: 'api' | 'estimate'; // api = APIが返した値 / estimate = 文字数からの概算
};

export type RunResult = {
  id: string;
  createdAt: number;
  modelKey: string;
  modelName: string;
  apiModelId?: string;
  provider: string;
  endpoint?: string; // 実際の送信先(許可リストの値)
  servedBy?: string; // 実際に処理した提供元(返ってきた場合のみ)
  pinnedProvider?: string; // 利用者が指定した提供元の識別名(指定したときだけ。ZDRの提供元に限定し、他へ切り替えない条件で送った)
  live: boolean; // 実通信か(false = 模擬)
  scenarioId: string;
  track: Scenario['track'];
  promptVersion?: number; // 指示文の版(記録のない古い結果は v1 として扱う)
  repeat: number;
  status: 'success' | 'error' | 'aborted';
  error?: string;
  request: {
    messages: ChatMessage[];
    requestedParams: Record<string, unknown>; // 共通の指定値
    sentParams: Record<string, unknown>; // 実際に送った値
    paramNotes: string[]; // 送らなかった設定・モデル固有の調整とその理由
  };
  output: string;
  parsed?: ParsedOutput;
  checks: CheckResult[];
  latencyMs: number;
  usage: Usage;
  price?: { inputUsdPerM: number; outputUsdPerM: number; checkedAt?: string; source?: string };
  costJpy?: number; // 推定。実際の請求額は未確認
  evaluation?: Evaluation; // 詳細評価(100点満点・任意)
  quick?: QuickEvaluation; // 簡易評価(基本)。記録のない結果は「未評価」
  env?: RunEnv; // 記録のない古い結果は「未記録」
};
