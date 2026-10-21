// 自動検査(補助評価)。最終判断は人の採点で行う。
// - mechanical: ゲーム状態や文字の割合など、機械的に確定できるもの(合格/不合格)
// - heuristic : 語句の有無による「疑い」の検出。言い換えは見逃すし、文脈によっては問題ない場合もある(該当なし/要確認)
//   語句が見つからなかったことは「問題がなかった」証明にはならない。
import { applyChanges } from '../../src/game/state';
import { splitChanges } from './parse';
import type { CheckResult, ParsedOutput, Scenario } from './types';

const JA = /[぀-ヿ㐀-鿿ｦ-ﾟ]/g;
const MONEY_TYPES = ['pay', 'receive', 'purchase', 'sell', 'setMoney'];

export function japaneseRatio(text: string): number {
  const chars = text.replace(/\s/g, '');
  if (!chars) return 0;
  const ja = chars.match(JA)?.length ?? 0;
  return ja / chars.length;
}

const mech = (label: string, ok: boolean, detail: string): CheckResult => ({ label, basis: 'mechanical', outcome: ok ? 'pass' : 'fail', detail });

export function runChecks(scenario: Scenario, output: string, parsed: ParsedOutput): CheckResult[] {
  const results: CheckResult[] = [];
  const body = splitChanges(output).body;
  const speech = parsed.blocks.filter((b) => b.type === 'speech').map((b) => b.text).join('\n');

  if (!body.trim()) return [mech('返答がある', false, '本文が空です')];
  const ratio = japaneseRatio(body);
  results.push(mech('日本語で書かれている', ratio >= 0.5, `日本語の文字の割合 ${Math.round(ratio * 100)}%`));
  results.push(
    parsed.changes === null
      ? { label: '状態変更の提案の形式', basis: 'mechanical', outcome: 'warn', detail: `${parsed.formatError ?? '形式どおりではありません'}(会話品質の採点とは別。アプリ側の対応で補える)` }
      : { label: '状態変更の提案の形式', basis: 'mechanical', outcome: 'pass', detail: `${parsed.changes.length}件の変更、${parsed.promises.length}件の約束` },
  );

  for (const rule of scenario.rules) {
    switch (rule.kind) {
      case 'mustNotInclude': {
        const target = rule.target === 'speech' ? speech : body;
        const found = rule.words.filter((w) => target.includes(w));
        results.push({
          label: rule.label,
          basis: 'heuristic',
          outcome: found.length ? 'warn' : 'pass',
          detail: found.length
            ? `次の語が含まれています: ${found.join('、')}。文脈を読んで判断してください`
            : '該当する語はありません(言い換えは検出できないため、問題がないとは限りません)',
        });
        break;
      }
      case 'mustIncludeAny': {
        const found = rule.words.filter((w) => body.includes(w));
        results.push({
          label: rule.label,
          basis: 'heuristic',
          outcome: found.length ? 'pass' : 'warn',
          detail: found.length ? `含まれている語: ${found.join('、')}` : `次のどれも含まれていません: ${rule.words.join('、')}。別の言い方で触れていないか確認してください`,
        });
        break;
      }
      case 'noMoneyChange': {
        if (!parsed.changes) {
          results.push({ label: rule.label, basis: 'mechanical', outcome: 'skip', detail: '状態変更の提案がないため判定できません。会話文で支払っていないかは人が確認してください' });
          break;
        }
        const moves = parsed.changes.filter((c) => MONEY_TYPES.includes(c.type));
        results.push(mech(rule.label, moves.length === 0, moves.length ? `所持金が動く提案があります: ${JSON.stringify(moves)}` : '状態変更の提案に、所持金を動かすものはありません'));
        break;
      }
      case 'noUnrequestedMoneyChange': {
        if (!parsed.changes) {
          results.push({ label: rule.label, basis: 'heuristic', outcome: 'skip', detail: '状態変更の提案がないため判定できません' });
          break;
        }
        const moves = parsed.changes.filter((c) => MONEY_TYPES.includes(c.type));
        results.push({
          label: rule.label,
          basis: 'heuristic',
          outcome: moves.length ? 'warn' : 'pass',
          detail: moves.length
            ? `取引の場面ではないのに、所持金が動く提案があります: ${JSON.stringify(moves)}。プレイヤーが頼んでいない購入・支払いなら、「プレイヤーの行動を勝手に確定した」重大問題かもしれません`
            : '所持金を動かす提案はありません',
        });
        break;
      }
      case 'noTransactionTalk': {
        // 本文だけを見る。語の有無による目安(「お代はいただきます」のような話題の紹介でも該当する)
        const TALK = /\d[\d,]*\s*G|代金|お代|お会計|お買い上げ|購入|お包み|包んで|包みながら|受け取っておき|お売り|毎度/g;
        const found = [...new Set(body.match(TALK) ?? [])];
        const moves = (parsed.changes ?? []).filter((c) => MONEY_TYPES.includes(c.type));
        results.push({
          label: rule.label,
          basis: 'heuristic',
          outcome: found.length ? 'warn' : 'pass',
          detail: found.length
            ? `本文に取引を思わせる語があります: ${found.join('、')}。${moves.length ? '状態変更の提案にも所持金の変更があります' : parsed.changes === null ? '状態変更の提案は読み取れませんでした' : '状態変更の提案には所持金の変更がありません(本文と状態が食い違う疑い)'}。商品の紹介だけなのか、取引が成立したように書いているのか、文脈を読んで判断してください`
            : '取引を思わせる語はありません(言い換えは検出できないため、問題がないとは限りません)',
        });
        break;
      }
      case 'paymentWithinFunds': {
        if (!parsed.changes) {
          results.push({ label: rule.label, basis: 'mechanical', outcome: 'skip', detail: '状態変更の提案がないため判定できません。会話文の内容は人が確認してください' });
          break;
        }
        const over: string[] = [];
        const doubtful: string[] = [];
        for (const c of parsed.changes) {
          const amount = c.type === 'pay' ? c.amount : c.type === 'purchase' ? c.price : undefined;
          if (amount !== undefined && amount > scenario.state.money) over.push(`所持金(${scenario.state.money})を超える支払い ${amount}`);
          // 決まった代金より少ない支払いは、値引きか分割払いかを文脈で判断する必要がある
          if (amount !== undefined && rule.expectedPrice && amount < rule.expectedPrice) doubtful.push(`決まった代金(${rule.expectedPrice})より少ない支払い ${amount}`);
          if (c.type === 'receive') doubtful.push(`収入の提案 ${c.amount}(根拠があるか確認)`);
        }
        results.push(mech(rule.label, over.length === 0, over.join(' / ') || '所持金を超える支払いの提案はありません'));
        if (doubtful.length) {
          results.push({ label: '値引き・臨時収入の疑い(状態変更の提案)', basis: 'heuristic', outcome: 'warn', detail: `${doubtful.join(' / ')}。値引きか、正当な分割払いなどかを文脈で判断してください` });
        }
        break;
      }
    }
  }

  // ゲーム状態エンジンで検証する(全シナリオ共通・機械的に確定)
  if (parsed.changes) {
    const applied = applyChanges(scenario.state, parsed.changes);
    results.push(mech('アプリの検証で成立する提案', applied.ok, applied.ok ? '状態変更の提案はアプリ側の検証で成立します' : `アプリ側で不成立になる提案です: ${applied.error}`));
  }
  return results;
}
