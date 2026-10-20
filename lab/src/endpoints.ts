// APIの送信先の許可リスト。ここにない送信先には送らない(任意のURLは入力できない)。
// APIキーは送信先ごとに分けて扱い、そのキーに対応する送信先以外には送らない。

export type Endpoint = {
  id: string;
  provider: string;
  url: string; // chat completions の完全なURL(HTTPSのみ)
  origin: string;
  auth: 'bearer';
  // ブラウザから直接呼べるか(CORS)。'確認済み' 以外は、この画面での接続確認に成功するまで実通信を無効にする
  browserDirect: '確認済み' | '未確認' | '不可';
  termsUrl: string;
  note: string;
};

export const ENDPOINTS: Record<string, Endpoint> = {
  openrouter: {
    id: 'openrouter',
    provider: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    origin: 'https://openrouter.ai',
    auth: 'bearer',
    browserDirect: '未確認',
    termsUrl: 'https://openrouter.ai/terms',
    note: '裏で処理する事業者ごとに、利用条件やデータの扱いが異なる。',
  },
  venice: {
    id: 'venice',
    provider: 'Venice',
    url: 'https://api.venice.ai/api/v1/chat/completions',
    origin: 'https://api.venice.ai',
    auth: 'bearer',
    browserDirect: '未確認',
    termsUrl: 'https://venice.ai/legal/tos',
    note: 'APIの残高はPro(月額)とは別。前払いは返金不可との情報。',
  },
};

// 送信先が許可リストの形どおりか(HTTPSで、決められたオリジンのURLか)
export function validateEndpoint(ep: Endpoint | undefined): string | null {
  if (!ep || ENDPOINTS[ep.id] !== ep) return '許可リストにない送信先です';
  let u: URL;
  try {
    u = new URL(ep.url);
  } catch {
    return '送信先のURLが正しくありません';
  }
  if (u.protocol !== 'https:') return 'HTTPS以外の送信先には送れません';
  if (u.origin !== ep.origin) return '送信先のオリジンが許可リストと一致しません';
  if (u.search || u.username || u.password) return '送信先のURLに余計な情報が含まれています';
  return null;
}

// 実通信を許可するか。ブラウザから直接つながることが確認できていない送信先は無効
export function liveBlockReason(ep: Endpoint | undefined, verified: ReadonlySet<string>): string | null {
  const invalid = validateEndpoint(ep);
  if (invalid) return invalid;
  if (ep!.browserDirect === '不可') return 'この送信先はブラウザから直接接続できないため、実通信は無効です';
  if (ep!.browserDirect !== '確認済み' && !verified.has(ep!.id)) {
    return 'ブラウザから直接接続できるか確認できていないため、実通信は無効です(「設定」タブの接続確認で有効になります)';
  }
  return null;
}

// fetch に必ず付ける設定。リダイレクトを追わない(認証情報を別の送信先に渡さない)・Cookieを送らない・参照元を送らない
export const SAFE_FETCH: Pick<RequestInit, 'redirect' | 'credentials' | 'referrerPolicy' | 'cache' | 'mode'> = {
  redirect: 'error',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  mode: 'cors',
};

// 接続確認: 本物のキーも会話も送らずに、ブラウザから応答を読めるか(CORS)だけを調べる。
// 中身のない要求を送るので、相手からは認証エラーなどが返る想定。応答が読めれば「接続できる」と判断する。
export async function checkBrowserAccess(ep: Endpoint, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  const invalid = validateEndpoint(ep);
  if (invalid) return { ok: false, detail: invalid };
  try {
    const res = await fetchImpl(ep.url, {
      ...SAFE_FETCH,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer connection-check-not-a-real-key' },
      body: '{}',
    });
    return { ok: true, detail: `応答を読めました(HTTP ${res.status})。ブラウザから直接接続できます。` };
  } catch {
    return { ok: false, detail: '応答を読めませんでした。ブラウザからの直接接続が拒否されたか、通信できません。' };
  }
}
