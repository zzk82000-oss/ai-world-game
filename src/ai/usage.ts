// 1日あたりのAI呼び出し回数の上限(意図しない課金・無制限の呼び出しを防ぐ)。
// 数えるのは「送信しようとした回数」(失敗しても数える)。日付は日本時間で切り替える。
export const DAILY_LIMIT = 400;
const KEY = 'ai-game-usage';

export type KV = { get(): string | null; set(v: string): void };
export type Usage = { date: string; count: number };

export const jstDate = (now: number) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function browserKV(): KV {
  let mem: string | null = null; // localStorage が使えないときは、画面を開いている間だけ数える
  return {
    get() {
      try {
        return localStorage.getItem(KEY);
      } catch {
        return mem;
      }
    },
    set(v) {
      mem = v;
      try {
        localStorage.setItem(KEY, v);
      } catch {
        /* 保存できなくても、メモリ上では数える */
      }
    },
  };
}

export function readUsage(kv: KV, now: number): Usage {
  const today = jstDate(now);
  try {
    const v = JSON.parse(kv.get() ?? 'null') as Usage | null;
    if (v && v.date === today && Number.isInteger(v.count) && v.count >= 0) return v;
  } catch {
    /* 読めなければ 0 から */
  }
  return { date: today, count: 0 };
}

// 送信の前に呼ぶ。上限に達していれば ok:false(数えない)
export function tryCount(kv: KV, now: number, limit = DAILY_LIMIT): { ok: boolean; count: number; limit: number } {
  const u = readUsage(kv, now);
  if (u.count >= limit) return { ok: false, count: u.count, limit };
  const next = { date: u.date, count: u.count + 1 };
  kv.set(JSON.stringify(next));
  return { ok: true, count: next.count, limit };
}
