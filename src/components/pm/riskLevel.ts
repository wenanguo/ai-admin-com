/**
 * 风险等级(score → level)的换算。
 *
 * ⚠️ level 是**派生量**:后端只有 score(= probability × impact,各 1–5),
 * 没有独立的 level 字段 —— 前端展示时按下面的阈值表现算。
 *
 * ⚠️ 阈值必须与 AI 服务侧的规则引擎(src/rule-engine/risk-matrix.ts,
 * 另一个仓库)**保持一致**:两边数字不一样,同一个风险就会在两个页面
 * 显示不同等级,是产品 bug。阈值的权威来源:docs/aipm/docs/02-domain-model.md §5.3。
 *
 * | score | 等级 |
 * |---|---|
 * | ≥ 16 | SEVERE 严重 |
 * | 9–15 | HIGH 高 |
 * | 4–8 | MEDIUM 中 |
 * | < 4 | LOW 低 |
 */

/** 风险等级(由 score 派生,后端只存 score) */
export type RiskLevel = 'SEVERE' | 'HIGH' | 'MEDIUM' | 'LOW';

/** score → 风险等级(阈值见文件头,必须与 AI 服务侧保持一致) */
export function riskLevel(score: number): RiskLevel {
  if (score >= 16) return 'SEVERE';
  if (score >= 9) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  return 'LOW';
}
