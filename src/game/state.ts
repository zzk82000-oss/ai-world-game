// ゲームの正式なデータと、その更新ルール。
// AIは「変更案」(Change)を返すだけで、残高や所持品の計算・確定はここで行う。
// どの更新も、成立しないときは元の状態を変えずに理由(error)を返す。

export type Item = { name: string; quantity?: number }; // quantity なし = 数量を管理しない物
export type FacilityStatus = 'ordered' | 'delivered' | 'installed';
export type Facility = { name: string; status: FacilityStatus };

export type LedgerEntry = {
  kind: 'pay' | 'receive' | 'edit';
  amount: number;
  before: number;
  after: number;
  reason?: string;
};

export type GameState = {
  currency: string; // 世界ごとに1種類(円・G など)
  money: number; // 通貨の最小単位までの整数
  items: Item[]; // 入手順。新しい物は末尾
  facilities: Facility[]; // 据え置きの設備。持ち歩く所持品とは別に管理する
  place: string;
  datetime: string;
  ledger: LedgerEntry[]; // 所持金の変更履歴
};

// 返答ごとに持たせる、その時点のステータス表示用の状態(履歴は含めない)
export type StatusSnapshot = Omit<GameState, 'ledger'>;

export function statusOf(state: GameState): StatusSnapshot {
  const { ledger: _ledger, ...rest } = state;
  return rest;
}

export type Change =
  | { type: 'pay'; amount: number; reason?: string }
  | { type: 'receive'; amount: number; reason?: string }
  | { type: 'purchase'; itemName: string; price: number; quantity?: number; reason?: string }
  | { type: 'sell'; itemName: string; price: number; quantity?: number; reason?: string }
  | { type: 'addItem'; name: string; quantity?: number }
  | { type: 'consumeItem'; name: string; quantity?: number }
  | { type: 'discardItem'; name: string }
  | { type: 'orderFacility'; name: string }
  | { type: 'setFacilityStatus'; name: string; status: FacilityStatus }
  | { type: 'setPlace'; place: string }
  | { type: 'setDatetime'; datetime: string }
  // 手動編集(プレイヤーによる修正)
  | { type: 'setMoney'; amount: number }
  | { type: 'setItemQuantity'; name: string; quantity?: number };

export type Result =
  | { ok: true; state: GameState }
  | { ok: false; error: string; failedIndex?: number };

const fail = (error: string): Result => ({ ok: false, error });

const isPositiveInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

export function createState(init: Partial<GameState> = {}): GameState {
  return {
    currency: 'G',
    money: 0,
    items: [],
    facilities: [],
    place: '',
    datetime: '',
    ledger: [],
    ...init,
  };
}

function changeMoney(
  state: GameState,
  kind: LedgerEntry['kind'],
  after: number,
  reason?: string,
): GameState {
  const entry: LedgerEntry = { kind, amount: Math.abs(after - state.money), before: state.money, after };
  if (reason) entry.reason = reason;
  return { ...state, money: after, ledger: [...state.ledger, entry] };
}

function findItem(state: GameState, name: string): Item | undefined {
  return state.items.find((i) => i.name === name);
}

function replaceItem(state: GameState, name: string, next: Item | null): GameState {
  const items = state.items.flatMap((i) => (i.name !== name ? [i] : next ? [next] : []));
  return { ...state, items };
}

function addItem(state: GameState, rawName: string, quantity?: number): Result {
  const name = rawName.trim();
  if (!name) return fail('物の名前が空です');
  if (quantity !== undefined && !isPositiveInt(quantity)) return fail('数量は1以上の整数にしてください');
  const have = findItem(state, name);
  if (!have) {
    return { ok: true, state: { ...state, items: [...state.items, quantity === undefined ? { name } : { name, quantity }] } };
  }
  // 数量を管理しない物を重ねて入手しても、すでに持っているだけで変わらない
  if (have.quantity === undefined && quantity === undefined) return { ok: true, state };
  // 数量なしで持っていた物に数を足すときは、1個持っていたものとして数える
  const sum = (have.quantity ?? 1) + (quantity ?? 1);
  return { ok: true, state: replaceItem(state, name, { name, quantity: sum }) };
}

function consumeItem(state: GameState, rawName: string, quantity = 1): Result {
  const name = rawName.trim();
  if (!isPositiveInt(quantity)) return fail('数量は1以上の整数にしてください');
  const have = findItem(state, name);
  if (!have) return fail(`「${name}」は持っていません`);
  if (have.quantity === undefined) return fail(`「${name}」は数量を管理していないので、使い切れません(手放す操作を使ってください)`);
  if (have.quantity < quantity) return fail(`「${name}」が足りません(所持 ${have.quantity}、必要 ${quantity})`);
  const left = have.quantity - quantity;
  return { ok: true, state: replaceItem(state, name, left === 0 ? null : { name, quantity: left }) };
}

function pay(state: GameState, amount: number, reason?: string): Result {
  if (!isPositiveInt(amount)) return fail('支払う金額は1以上の整数にしてください');
  if (amount > state.money) {
    return fail(`所持金が足りません(所持 ${state.money}${state.currency}、必要 ${amount}${state.currency})`);
  }
  return { ok: true, state: changeMoney(state, 'pay', state.money - amount, reason) };
}

function receive(state: GameState, amount: number, reason?: string): Result {
  if (!isPositiveInt(amount)) return fail('受け取る金額は1以上の整数にしてください');
  const after = state.money + amount;
  if (!Number.isSafeInteger(after)) return fail('所持金が大きすぎます');
  return { ok: true, state: changeMoney(state, 'receive', after, reason) };
}

function andThen(r: Result, next: (s: GameState) => Result): Result {
  return r.ok ? next(r.state) : r;
}

export function applyChange(state: GameState, change: Change): Result {
  switch (change.type) {
    case 'pay':
      return pay(state, change.amount, change.reason);
    case 'receive':
      return receive(state, change.amount, change.reason);
    case 'purchase':
      // 支払いと入手を一体で確定する。どちらかが失敗したら、どちらも反映しない
      return andThen(pay(state, change.price, change.reason ?? `${change.itemName}を購入`), (s) =>
        addItem(s, change.itemName, change.quantity),
      );
    case 'sell':
      return andThen(consumeOrDiscard(state, change.itemName, change.quantity), (s) =>
        receive(s, change.price, change.reason ?? `${change.itemName}を売却`),
      );
    case 'addItem':
      return addItem(state, change.name, change.quantity);
    case 'consumeItem':
      return consumeItem(state, change.name, change.quantity);
    case 'discardItem': {
      const name = change.name.trim();
      if (!findItem(state, name)) return fail(`「${name}」は持っていません`);
      return { ok: true, state: replaceItem(state, name, null) };
    }
    case 'orderFacility': {
      const name = change.name.trim();
      if (!name) return fail('設備の名前が空です');
      if (state.facilities.some((f) => f.name === name)) return fail(`「${name}」はすでに登録されています`);
      return { ok: true, state: { ...state, facilities: [...state.facilities, { name, status: 'ordered' }] } };
    }
    case 'setFacilityStatus': {
      const name = change.name.trim();
      if (!state.facilities.some((f) => f.name === name)) return fail(`設備「${name}」は登録されていません`);
      return {
        ok: true,
        state: { ...state, facilities: state.facilities.map((f) => (f.name === name ? { ...f, status: change.status } : f)) },
      };
    }
    case 'setPlace': {
      const place = change.place.trim();
      if (!place) return fail('場所が空です');
      return { ok: true, state: { ...state, place } };
    }
    case 'setDatetime': {
      const datetime = String(change.datetime ?? '').trim();
      if (!datetime) return fail('日時が空です');
      if (datetime.length > 40) return fail('日時が長すぎます(40文字まで)');
      return { ok: true, state: { ...state, datetime } };
    }
    case 'setMoney':
      if (!Number.isSafeInteger(change.amount) || change.amount < 0) return fail('所持金は0以上の整数にしてください');
      return { ok: true, state: changeMoney(state, 'edit', change.amount, '手動で編集') };
    case 'setItemQuantity': {
      const name = change.name.trim();
      if (!findItem(state, name)) return fail(`「${name}」は持っていません`);
      if (change.quantity === undefined) return { ok: true, state: replaceItem(state, name, { name }) };
      if (!Number.isSafeInteger(change.quantity) || change.quantity < 0) return fail('数量は0以上の整数にしてください');
      return { ok: true, state: replaceItem(state, name, change.quantity === 0 ? null : { name, quantity: change.quantity }) };
    }
  }
}

// 売却: 数量を管理している物は指定数を減らし、数量なしの物は手放す
function consumeOrDiscard(state: GameState, rawName: string, quantity?: number): Result {
  const name = rawName.trim();
  const have = findItem(state, name);
  if (!have) return fail(`「${name}」は持っていません`);
  if (have.quantity === undefined) {
    if (quantity !== undefined && quantity !== 1) return fail(`「${name}」は数量を管理していません`);
    return { ok: true, state: replaceItem(state, name, null) };
  }
  return consumeItem(state, name, quantity ?? 1);
}

// 1ターン分の変更をまとめて適用する。1つでも成立しなければ、全部反映しない
export function applyChanges(state: GameState, changes: Change[]): Result {
  let current = state;
  for (let i = 0; i < changes.length; i++) {
    const r = applyChange(current, changes[i]);
    if (!r.ok) return { ok: false, error: r.error, failedIndex: i };
    current = r.state;
  }
  return { ok: true, state: current };
}
