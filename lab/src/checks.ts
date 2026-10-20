// 客観的に確かめられる部分の自動検査(目安)。文章の魅力などは人が採点する。
import { applyChanges } from '../../src/game/state';
import { splitChanges } from './parse';
import type { CheckResult, ParsedOutput, Scenario } from './types';

const JA = /[぀-ヿ㐀-鿿ｦ-ﾟ]/g;

export function japaneseRatio(text: string): number {
  const chars = text.replace(/\s/g, '');
  if (!chars) return 0;
  const ja = chars.match(JA)?.length ?? 0;
  return ja / chars.length;
}

export function runChecks(scenario: Scenario, output: string, parsed: ParsedOutput): CheckResult[] {
  const results: CheckResult[] = [];
  const body = splitChanges(output).body;
  const speech = parsed.blocks.filter((b) => b.type === 'speech').map((b) => b.text).join('\n');

  if (!body.trim()) {
    return [{ label: '返答がある', outcome: 'fail', detail: '本文が空です' }];
  }
  const ratio = japaneseRatio(body);
  results.push({
    label: '日本語で書かれている',
    outcome: ratio >= 0.5 ? 'pass' : 'fail',
    detail: `日本語の文字の割合 ${Math.round(ratio * 100)}%`,
  });
  results.push(
    parsed.changes === null
      ? { label: '状態変更の提案の形式', outcome: 'warn', detail: parsed.formatError ?? '形式どおりではありません(採点の対象外。アプリ側の対応で補える)' }
      : { label: '状態変更の提案の形式', outcome: 'pass', detail: `${parsed.changes.length}件の変更、${parsed.promises.length}件の約束` },
  );

  const applied = parsed.changes ? applyChanges(scenario.state, parsed.changes) : null;

  for (const rule of scenario.rules) {
    switch (rule.kind) {
      case 'mustNotInclude': {
        const target = rule.target === 'speech' ? speech : body;
        const found = rule.words.filter((w) => target.includes(w));
        results.push({
          label: rule.label,
          outcome: found.length ? rule.severity : 'pass',
          detail: found.length ? `次の語が含まれています: ${found.join('、')}` : '問題の語は見つかりません',
        });
        break;
      }
      case 'mustIncludeAny': {
        const found = rule.words.filter((w) => body.includes(w));
        results.push({
          label: rule.label,
          outcome: found.length ? 'pass' : rule.severity,
          detail: found.length ? `含まれている語: ${found.join('、')}` : `次のどれも含まれていません: ${rule.words.join('、')}`,
        });
        break;
      }
      case 'noMoneyChange': {
        if (!parsed.changes) {
          results.push({ label: rule.label, outcome: 'skip', detail: '状態変更の提案がないため判定できません' });
          break;
        }
        const moneyMoves = parsed.changes.filter((c) => ['pay', 'receive', 'purchase', 'sell', 'setMoney'].includes(c.type));
        results.push({
          label: rule.label,
          outcome: moneyMoves.length ? 'fail' : 'pass',
          detail: moneyMoves.length ? `所持金が動く提案があります: ${JSON.stringify(moneyMoves)}` : '所持金を動かす提案はありません',
        });
        break;
      }
      case 'paymentWithinFunds': {
        if (!parsed.changes) {
          results.push({ label: rule.label, outcome: 'skip', detail: '状態変更の提案がないため判定できません' });
          break;
        }
        const problems: string[] = [];
        for (const c of parsed.changes) {
          const amount = c.type === 'pay' ? c.amount : c.type === 'purchase' ? c.price : undefined;
          if (amount !== undefined && amount > scenario.state.money) problems.push(`所持金(${scenario.state.money})を超える支払い ${amount}`);
          if (amount !== undefined && rule.expectedPrice && amount < rule.expectedPrice) problems.push(`決まった代金(${rule.expectedPrice})より少ない支払い ${amount}(値引きの可能性)`);
          if (c.type === 'receive') problems.push(`根拠のない収入の可能性 ${c.amount}`);
        }
        results.push({ label: rule.label, outcome: problems.length ? 'fail' : 'pass', detail: problems.join(' / ') || '問題のある支払いの提案はありません' });
        break;
      }
    }
  }

  if (applied && !applied.ok) {
    results.push({ label: 'アプリの検証で成立する提案', outcome: 'warn', detail: `アプリ側で不成立になる提案です: ${applied.error}` });
  }
  return results;
}
