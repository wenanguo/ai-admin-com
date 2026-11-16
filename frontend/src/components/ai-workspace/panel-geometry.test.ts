/**
 * 面板几何的**纯计算**（夹宽、夹位置、校验存储值）。
 */

import { describe, expect, it } from 'vitest';
import {
  AI_WORKSPACE_MIN_WIDTH,
  clampGeometry,
  clampWidth,
  parsePanelGeometry,
} from './panel-geometry';

describe('clampWidth', () => {
  it('下限是最小宽度（320）', () => {
    expect(clampWidth(100, 1000)).toBe(AI_WORKSPACE_MIN_WIDTH);
  });

  it('上限是内容区宽', () => {
    expect(clampWidth(5000, 1000)).toBe(1000);
  });

  it('中间的值原样返回（取整）', () => {
    expect(clampWidth(520.7, 1000)).toBe(520);
  });

  it('最大宽度比最小宽度还小 ⇒ 退化成最小宽度（不许出现负宽度）', () => {
    expect(clampWidth(500, 100)).toBe(AI_WORKSPACE_MIN_WIDTH);
  });
});

describe('clampGeometry', () => {
  it('面板不会拖出视口（左边/上边）', () => {
    const result = clampGeometry(
      { left: -50, top: -80, width: 400, height: 300 },
      1440,
      900,
    );
    expect(result.left).toBe(0);
    expect(result.top).toBe(0);
  });

  it('面板不会拖出视口（右边/下边）', () => {
    const result = clampGeometry(
      { left: 1200, top: 800, width: 400, height: 300 },
      1440,
      900,
    );
    expect(result.left).toBe(1040);
    expect(result.top).toBe(600);
  });

  it('视口变窄 ⇒ 宽度跟着夹（不许超出屏幕）', () => {
    const result = clampGeometry(
      { left: 900, top: 0, width: 800, height: 300 },
      1000,
      900,
    );
    expect(result.width).toBeLessThanOrEqual(1000);
    expect(result.left + result.width).toBeLessThanOrEqual(1000);
  });
});

describe('parsePanelGeometry', () => {
  it('合法值 ⇒ 原样返回', () => {
    expect(
      parsePanelGeometry({ left: 10, top: 20, width: 400, height: 560 }),
    ).toEqual({ left: 10, top: 20, width: 400, height: 560 });
  });

  it('不是对象 / 有字段不对 ⇒ 当没有（不能把界面搞崩）', () => {
    expect(parsePanelGeometry(undefined)).toBeUndefined();
    expect(parsePanelGeometry(null)).toBeUndefined();
    expect(parsePanelGeometry('x')).toBeUndefined();
    expect(parsePanelGeometry([1, 2])).toBeUndefined();
    expect(parsePanelGeometry({ left: 1, top: 2, width: 3 })).toBeUndefined();
    expect(
      parsePanelGeometry({ left: 'a', top: 2, width: 3, height: 4 }),
    ).toBeUndefined();
  });
});
