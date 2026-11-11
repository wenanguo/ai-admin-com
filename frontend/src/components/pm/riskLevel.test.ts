import { describe, expect, it } from 'vitest';
import { riskLevel } from './riskLevel';

/**
 * 风险等级换算(score → level)的单测。
 *
 * score = probability × impact(各 1–5),level 是**派生量** —— 后端只存 score,
 * 前端按阈值表现算。这张表必须与 AI 服务侧的规则引擎
 * (src/rule-engine/risk-matrix.ts,另一个仓库)保持一致:
 * 两边数字不同,同一个风险在两个页面就显示不同等级,是产品 bug。
 * 所以边界值一条条钉死在这儿:
 *
 * ≥ 16 → SEVERE / 9–15 → HIGH / 4–8 → MEDIUM / < 4 → LOW
 */
describe('riskLevel 风险等级换算', () => {
  it('分数 16 是严重 / 15 是高 / 8 是中 / 3 是低', () => {
    expect(riskLevel(16)).toBe('SEVERE');
    expect(riskLevel(15)).toBe('HIGH');
    expect(riskLevel(8)).toBe('MEDIUM');
    expect(riskLevel(3)).toBe('LOW');
  });

  it('边界值 16 / 9 / 4 各自落在正确等级(阈值含边界本身)', () => {
    // 16 是 SEVERE 的下界(含)
    expect(riskLevel(16)).toBe('SEVERE');
    // 9 是 HIGH 的下界(含)
    expect(riskLevel(9)).toBe('HIGH');
    // 4 是 MEDIUM 的下界(含)
    expect(riskLevel(4)).toBe('MEDIUM');
  });
});
