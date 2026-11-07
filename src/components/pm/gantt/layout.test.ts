import { describe, expect, it } from 'vitest';
import {
  COLUMN_SPECS,
  computeColumnWidths,
  computeGridWidth,
  computeTimelineWidth,
  MAX_GRID_WIDTH,
  MIN_GRID_WIDTH,
} from './layout';

/**
 * 左表格宽度口径的单测(纯函数,不起浏览器)。
 *
 * 钉死这些事(F1 的根因与修法):
 * 1. **标题列有可读的最小宽度**:网格再窄,标题列也不能被压到「三个点」;
 * 2. **网格总宽跟着容器走**:容器宽 ⇒ 网格宽(容器窄 ⇒ 网格窄);
 * 3. 各列宽度加起来正好等于网格总宽(dhtmlx 的网格宽 = 列宽之和);
 * 4. 用户拖分隔条拖出来的宽度**优先**(但仍受上下限约束)。
 */

describe('computeColumnWidths 左表格列宽', () => {
  it('各列宽度加起来正好等于网格总宽', () => {
    for (const gridWidth of [MIN_GRID_WIDTH, 500, 620]) {
      const widths = computeColumnWidths(gridWidth);
      const sum = Object.values(widths).reduce(
        (total, width) => total + width,
        0,
      );
      expect(sum).toBe(gridWidth);
    }
  });

  it('网格最窄时,标题列仍保住它的最小宽度(160)', () => {
    const widths = computeColumnWidths(MIN_GRID_WIDTH);
    expect(widths.title).toBe(COLUMN_SPECS.title.min);
    expect(widths.title).toBeGreaterThanOrEqual(160);
    // 其余列被压到自己的下限(不是 0)
    expect(widths.assignee).toBe(COLUMN_SPECS.assignee.min);
    expect(widths.dates).toBe(COLUMN_SPECS.dates.min);
  });

  it('空间富余时,多出来的宽度先给标题列', () => {
    const widths = computeColumnWidths(MAX_GRID_WIDTH);
    expect(widths.title).toBeGreaterThan(COLUMN_SPECS.title.width);
    // 其余列不超过自己的自然宽
    expect(widths.assignee).toBeLessThanOrEqual(COLUMN_SPECS.assignee.max);
  });

  it('网格总宽比自然宽之和还小时,先压别的列、标题列最后压', () => {
    const natural =
      COLUMN_SPECS.title.width +
      COLUMN_SPECS.assignee.width +
      COLUMN_SPECS.status.width +
      COLUMN_SPECS.priority.width +
      COLUMN_SPECS.dates.width;
    const widths = computeColumnWidths(natural - 30);
    // 先压「起止」(压到下限 104)与「优先级」(压到下限 56),其余 6 压「状态」
    // ⇒ 标题列一个像素都没少(它最后才被压)
    expect(widths.title).toBe(COLUMN_SPECS.title.width);
    expect(widths.dates).toBe(COLUMN_SPECS.dates.min);
    expect(widths.priority).toBe(COLUMN_SPECS.priority.min);
    expect(widths.status).toBe(COLUMN_SPECS.status.width - 6);
  });
});

describe('computeGridWidth 网格总宽跟着容器走', () => {
  it('容器变宽 ⇒ 网格变宽(时间轴与左表格都在同一块地方分)', () => {
    const narrow = computeGridWidth(700);
    const wide = computeGridWidth(1400);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('容器窄时,网格不会窄到把标题列压扁', () => {
    expect(computeGridWidth(320)).toBe(MIN_GRID_WIDTH);
    expect(computeGridWidth(500)).toBeGreaterThanOrEqual(MIN_GRID_WIDTH);
  });

  it('网格再宽也不超过上限(剩下的留给时间轴)', () => {
    expect(computeGridWidth(4000)).toBe(MAX_GRID_WIDTH);
  });

  it('用户拖分隔条拖出来的宽度优先(但仍受上下限约束)', () => {
    // 拖到 500 ⇒ 就按 500 算(不再按比例)
    expect(computeGridWidth(1400, 500)).toBe(500);
    // 拖得太窄 ⇒ 夹到下限
    expect(computeGridWidth(1400, 10)).toBe(MIN_GRID_WIDTH);
    // 拖得太宽 ⇒ 夹到上限(容器还得给时间轴留地方)
    expect(computeGridWidth(1400, 5000)).toBeLessThanOrEqual(MAX_GRID_WIDTH);
  });

  it('时间轴宽度 = 容器宽 - 网格总宽', () => {
    expect(computeTimelineWidth(1400)).toBe(1400 - computeGridWidth(1400));
  });
});
