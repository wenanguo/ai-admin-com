import type { ProColumns } from '@ant-design/pro-components';
import { describe, expect, it } from 'vitest';
import { isMergedCell, toAntdOperationColumn, toNodeArray } from './index';

/**
 * 「ProColumns → antd Table 列」适配层的单测。
 *
 * 钉住四件事:
 * 1. 列标题**来自脚手架**(`column.title`),拿不到才回落到 '操作'
 *    —— 硬编码标题会让两张表在脚手架改文案后**静默**对不上
 * 2. 渲染走的是脚手架的 render(按钮的权限门控仍然只有一份实现)
 * 3. ProTable 的合并单元格形态 `{ children, props }` 会被拆成 children
 *    (普通 antd Table 不认这个形态,原样渲染会炸)
 * 4. `toNodeArray` 把脚手架那组按钮摊平成数组(角色页要在后面追加自己的入口)
 */

type DemoRecord = { id?: number | null; name?: string | null };

/** 造一个脚手架操作列(shape 与 `useCrudColumns` 给的一致) */
function makeColumn(
  overrides: Partial<ProColumns<DemoRecord>> = {},
): ProColumns<DemoRecord> {
  return {
    title: '操作',
    valueType: 'option',
    render: (_dom, record) => [<span key="edit">{record.name}</span>],
    ...overrides,
  };
}

describe('AntdOperationColumn 操作列适配层', () => {
  it('列标题取脚手架的 title,不是写死的', () => {
    const column = toAntdOperationColumn(
      makeColumn({ title: '批量操作' }),
      110,
    );

    expect(column.title).toBe('批量操作');
  });

  it('脚手架没给标题时回落到「操作」', () => {
    const column = toAntdOperationColumn(makeColumn({ title: undefined }), 110);

    expect(column.title).toBe('操作');
  });

  it('列宽按入参给', () => {
    const column = toAntdOperationColumn(makeColumn(), 110);

    expect(column.width).toBe(110);
  });

  it('渲染走脚手架的 render,并把当前行传进去', () => {
    const seen: DemoRecord[] = [];
    const column = toAntdOperationColumn(
      makeColumn({
        render: (_dom, record) => {
          seen.push(record);
          return '脚手架的按钮';
        },
      }),
      110,
    );

    const record: DemoRecord = { id: 7, name: '管理员' };
    const output = column.render?.(undefined, record, 0);

    expect(seen).toEqual([record]);
    expect(output).toBe('脚手架的按钮');
  });

  it('合并单元格形态拆成 children(普通表格不认 { children, props })', () => {
    const column = toAntdOperationColumn(
      makeColumn({
        render: () => ({ children: '合并', props: { colSpan: 2 } }),
      }),
      110,
    );

    const output = column.render?.(undefined, { id: 7 }, 0);

    expect(output).toBe('合并');
  });

  it('toNodeArray:数组原样摊平、空值摊成空数组、合并单元格取 children', () => {
    expect(toNodeArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(toNodeArray(null)).toEqual([]);
    expect(toNodeArray(undefined)).toEqual([]);
    expect(toNodeArray('a')).toEqual(['a']);
    expect(toNodeArray({ children: 'a', props: {} })).toEqual(['a']);
  });

  it('isMergedCell:只认同时有 children 与 props 的对象', () => {
    expect(isMergedCell({ children: 'a', props: {} })).toBe(true);
    expect(isMergedCell({ children: 'a' })).toBe(false);
    expect(isMergedCell(null)).toBe(false);
    expect(isMergedCell('a')).toBe(false);
  });
});
