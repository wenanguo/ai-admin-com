import { Tag, theme } from 'antd';
import type React from 'react';
import { Fragment, useMemo } from 'react';
import {
  RISK_LEVEL_COLOR,
  riskLevel,
  riskLevelLabel,
} from '@/components/pm/riskLevel';
import type { RiskOut } from '@/services/api/pm/risk';

/**
 * 风险热力图(5×5):横轴是**影响**,纵轴是**概率**。
 *
 * - 每格显示落在该(概率, 影响)格子里的**风险数**
 * - 格子的颜色取该格**最高分**对应的等级(共享件 riskLevel 派生,后端没有 level 字段)
 * - 点格子过滤下面的列表;**只读** —— 不做拖拽建风险
 * - 没有风险的格子照样渲染(零),点它过滤出空列表,而不是什么也不做
 */

/** 热力图的一个格子:概率 × 影响 */
export type RiskCell = {
  /** 概率 1-5 */
  probability: number;
  /** 影响 1-5 */
  impact: number;
};

/** 热力图的 props */
export type RiskHeatmapProps = {
  /** 全量风险(最多 100 条):格子的数量与颜色从这里算 */
  risks: RiskOut[];
  /** 当前选中的格子;null = 不过滤 */
  selected: RiskCell | null;
  /** 点格子;再点同一个格子 = 取消过滤 */
  onSelect: (cell: RiskCell | null) => void;
};

/** 概率与影响的取值范围(后端是 1-5) */
const SCALE = [1, 2, 3, 4, 5];

/** 一个格子的统计:落在格子里的风险数 + 格子里的最高分 */
type CellStat = {
  /** 落在这一格的风险数 */
  count: number;
  /** 这一格里的最高分(没有分数时是 null) */
  maxScore: number | null;
};

/**
 * 风险列表 → 每格的统计。
 *
 * 只认概率与影响都在 1-5 的行(后端就是 1-5,越界的行不落到任何格子里);
 * 分数只读后端存的值 —— **不在这里重算** score(那是表单提交时的事)。
 */
function useCellStats(risks: RiskOut[]): Map<string, CellStat> {
  return useMemo(() => {
    const stats = new Map<string, CellStat>();

    for (const risk of risks) {
      const { probability, impact } = risk;
      if (probability == null || impact == null) continue;
      if (probability < 1 || probability > 5) continue;
      if (impact < 1 || impact > 5) continue;

      const key = `${probability}-${impact}`;
      const stat = stats.get(key) ?? { count: 0, maxScore: null };
      stat.count += 1;
      if (risk.score != null) {
        stat.maxScore =
          stat.maxScore == null
            ? risk.score
            : Math.max(stat.maxScore, risk.score);
      }
      stats.set(key, stat);
    }

    return stats;
  }, [risks]);
}

/**
 * 风险热力图。
 *
 * 等级是**派生量**:后端只存 score(= 概率 × 影响),没有 level 字段,
 * 颜色与文案都走共享件 riskLevel / riskLevelLabel / RISK_LEVEL_COLOR。
 */
const RiskHeatmap: React.FC<RiskHeatmapProps> = ({
  risks,
  selected,
  onSelect,
}) => {
  const { token } = theme.useToken();
  const stats = useCellStats(risks);

  /** 一个格子 */
  const renderCell = (probability: number, impact: number) => {
    const stat = stats.get(`${probability}-${impact}`);
    const count = stat?.count ?? 0;
    // 颜色按这一格的**最高分**:等级由共享件派生,这里不重算分数
    const level = stat?.maxScore != null ? riskLevel(stat.maxScore) : null;
    const isSelected =
      selected?.probability === probability && selected?.impact === impact;

    return (
      <button
        key={`${probability}-${impact}`}
        type="button"
        data-risk-cell={`${probability}-${impact}`}
        aria-label={`概率 ${probability} 影响 ${impact}:${count} 条风险${
          level ? `,等级${riskLevelLabel(level)}` : ''
        }`}
        // 再点同一个格子 = 取消过滤
        onClick={() => onSelect(isSelected ? null : { probability, impact })}
        style={{
          border: `1px solid ${isSelected ? token.colorPrimary : token.colorBorder}`,
          borderRadius: 6,
          background: token.colorFillQuaternary,
          cursor: 'pointer',
          padding: '6px 0',
          textAlign: 'center',
        }}
      >
        {/* 等级的颜色由共享件给(antd Tag 预设色) */}
        <Tag color={level ? RISK_LEVEL_COLOR[level] : 'default'}>{count}</Tag>
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">风险热力图</span>
        <span className="text-sm text-neutral-500">
          {selected
            ? `已筛选：概率 ${selected.probability} × 影响 ${selected.impact}（再点一次取消）`
            : '点格子筛选下面的列表'}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `auto repeat(${SCALE.length}, minmax(56px, 1fr))`,
          // 不让网格铺满整页:热力图是一个方阵,太宽就不像矩阵了
          maxWidth: 680,
          gap: 4,
        }}
      >
        {/* 表头:横轴是影响 */}
        <div />
        {SCALE.map((impact) => (
          <div
            key={`head-${impact}`}
            className="text-center text-xs text-neutral-500"
          >
            影响 {impact}
          </div>
        ))}
        {/* 纵轴:概率(1 在上、5 在下,与影响一起往右下越来越严重) */}
        {SCALE.map((probability) => (
          <Fragment key={`row-${probability}`}>
            <div className="pr-2 text-xs text-neutral-500">
              概率 {probability}
            </div>
            {SCALE.map((impact) => renderCell(probability, impact))}
          </Fragment>
        ))}
      </div>
    </div>
  );
};

export default RiskHeatmap;
