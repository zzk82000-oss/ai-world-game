// 長期記憶(セーブごと)。古い会話から、出来事・約束・関係の転機・各人物が知っていることを、短い事実として残す。
// 人物の性格・口調・所持金・場所などは入れない(それぞれ、人物設定・状態管理が正)。AIの解釈・推測は残さない。
export type MemoryKind = 'event' | 'promise' | 'relationship' | 'knowledge';
export const MEMORY_KINDS: { key: MemoryKind; label: string }[] = [
  { key: 'event', label: '出来事' },
  { key: 'promise', label: '約束・依頼' },
  { key: 'relationship', label: '関係の転機' },
  { key: 'knowledge', label: '知っていること' },
];

export type MemoryItem = {
  id: string;
  kind: MemoryKind;
  text: string; // 1つの事実(短い1文)
  knownBy: string[]; // 知っている人物(空 = 指定なし・全員が知りうる)
  done?: boolean; // 約束・依頼が、すでに果たされたか
  source: 'ai' | 'player'; // ai = 要約で作られた / player = 利用者が追加・編集した
};

export type Memory = {
  items: MemoryItem[];
  upTo: number; // この番号までの会話は、要約済み(0 = まだ要約していない)
  version: 1;
};

export const MEMORY_ITEM_MAX = 120; // 1項目の文字数
export const MEMORY_TOTAL_MAX = 2500; // 全項目の合計文字数(AIに渡す量の上限)
export const MEMORY_COUNT_MAX = 60;

export const emptyMemory = (): Memory => ({ items: [], upTo: 0, version: 1 });

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function validateMemory(m: unknown): string | null {
  if (!isObj(m) || !Array.isArray(m.items) || !Number.isInteger(m.upTo) || (m.upTo as number) < 0) return '記憶のデータが正しくありません';
  if (m.items.length > MEMORY_COUNT_MAX) return `記憶は、${MEMORY_COUNT_MAX}件までです`;
  const ids = new Set<string>();
  for (const it of m.items) {
    if (!isObj(it) || typeof it.id !== 'string' || !it.id || ids.has(it.id)) return '記憶の項目が正しくありません';
    ids.add(it.id);
    if (!MEMORY_KINDS.some((k) => k.key === it.kind)) return '記憶の種類が正しくありません';
    if (typeof it.text !== 'string' || !it.text.trim() || it.text.length > MEMORY_ITEM_MAX) return `記憶は、1件${MEMORY_ITEM_MAX}文字までです`;
    if (!Array.isArray(it.knownBy) || it.knownBy.length > 10 || it.knownBy.some((n) => typeof n !== 'string' || n.length > 16)) return '「知っている人物」が正しくありません';
    if (it.done !== undefined && typeof it.done !== 'boolean') return '記憶の項目が正しくありません';
    if (it.source !== 'ai' && it.source !== 'player') return '記憶の項目が正しくありません';
  }
  if ((m.items as MemoryItem[]).reduce((a, i) => a + i.text.length, 0) > MEMORY_TOTAL_MAX + MEMORY_ITEM_MAX) return '記憶が、長すぎます';
  return null;
}

const total = (items: MemoryItem[]) => items.reduce((a, i) => a + i.text.length, 0);

// 上限を超えたときの整理: 利用者が書いたもの・未履行の約束・関係の転機は残し、古い「出来事」と、履行済みの約束から、捨てる
export function trimMemory(items: MemoryItem[]): MemoryItem[] {
  const out = [...items];
  const droppable = (i: MemoryItem) => i.source === 'ai' && (i.kind === 'event' || (i.kind === 'promise' && i.done) || i.kind === 'knowledge');
  while ((total(out) > MEMORY_TOTAL_MAX || out.length > MEMORY_COUNT_MAX) && out.some(droppable)) {
    out.splice(out.findIndex(droppable), 1); // 古いもの(先頭側)から
  }
  return out;
}

// 要約の結果(追加する項目と、果たされた約束)を、記憶に取り込む。既存の項目は、書き換えない
export type SummaryDelta = { add: { kind: MemoryKind; text: string; knownBy: string[] }[]; resolve: string[] };

export function mergeMemory(mem: Memory, delta: SummaryDelta, upTo: number, newId: () => string): Memory {
  const items = mem.items.map((i) => ({ ...i }));
  for (const id of delta.resolve) {
    const t = items.find((i) => i.id === id && i.kind === 'promise');
    if (t) t.done = true;
  }
  const seen = new Set(items.map((i) => i.text.trim()));
  for (const a of delta.add) {
    const text = a.text.trim().slice(0, MEMORY_ITEM_MAX);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push({ id: newId(), kind: a.kind, text, knownBy: a.knownBy, ...(a.kind === 'promise' ? { done: false } : {}), source: 'ai' });
  }
  return { items: trimMemory(items), upTo, version: 1 };
}

// 要約の返答(JSON)を読み取る。形式が崩れていたら null(記憶は、変えない)
export function parseSummary(text: string, knownIds: Set<string>): SummaryDelta | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!isObj(data) || !Array.isArray(data.add)) return null;
  const add: SummaryDelta['add'] = [];
  for (const a of data.add) {
    if (!isObj(a) || typeof a.text !== 'string' || !MEMORY_KINDS.some((k) => k.key === a.kind)) continue;
    const knownBy = Array.isArray(a.knownBy) ? a.knownBy.filter((n): n is string => typeof n === 'string' && n.length > 0 && n.length <= 16).slice(0, 10) : [];
    add.push({ kind: a.kind as MemoryKind, text: a.text, knownBy });
  }
  const resolve = Array.isArray(data.resolve) ? data.resolve.filter((x): x is string => typeof x === 'string' && knownIds.has(x)) : [];
  return { add, resolve };
}

// AIへの指示に入れる、記憶の文章
export function memoryText(mem: Memory | undefined): string {
  const items = mem?.items ?? [];
  if (!items.length) return '';
  const lines = items.map((i) => {
    const kind = MEMORY_KINDS.find((k) => k.key === i.kind)?.label ?? '';
    const who = i.knownBy.length ? `(知っている人: ${i.knownBy.join('、')})` : '';
    const done = i.kind === 'promise' ? (i.done ? '(果たし済み)' : '(まだ果たされていない)') : '';
    return `- [${kind}]${i.text}${done}${who}`;
  });
  return `# 長期記憶(これまでの出来事・事実。古い会話の要約。守る)\n${lines.join('\n')}\n※「知っている人」が書かれた事実は、その人物以外は知らないものとして振る舞う。記憶にないことを、後付けで作らない。`;
}
