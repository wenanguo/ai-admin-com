/**
 * 窄版 AI 工作台面板的**几何**（位置与宽度）。
 *
 * ## 为什么单独一个模块
 *
 * 面板的几何有三处要碰：**拖动**（算新位置）· **渲染**（样式）· **存储**（刷新后还在）。
 * ⇒ 纯计算的部分放这里（不碰 React、不碰 DOM）⇒ 好测、好复用。
 *
 * ## 口径
 *
 * - **宽度**：最小 `AI_WORKSPACE_MIN_WIDTH`（320px），最大**不超过内容区宽**
 *   （内容区 = ProLayout 的内容那块，不含左侧菜单）；
 * - **位置**：夹在视口内（面板不会拖到屏幕外找不着）；
 * - **高度**：默认仍是「顶到视口上下沿」（今天的行为，一个字不改）；
 *   用户**拖动标题**之后面板变成「浮动窗口」（高度 `AI_WORKSPACE_FLOAT_HEIGHT`）
 *   ⇒ 否则一块占满整屏高的面板**没法上下挪**（拖了也只会卡在 top=0）。
 */

/** 面板的最小宽度（px）。 */
export const AI_WORKSPACE_MIN_WIDTH = 320;

/**
 * 拖动之后面板变成浮动窗口时的高度（px）。
 *
 * ⚠️ **为什么不是整屏高**：占满整屏高的面板**上下拖不动**
 *    （top 只能是 0）⇒ 「可拖到视口内任意位置」就不成立。
 * ⇒ 拖动标题 ⇒ 变成这个高度的一个窗口 ⇒ 上下左右都能摆。
 */
export const AI_WORKSPACE_FLOAT_HEIGHT = 560;

/** 面板的几何（视口坐标，单位 px）。 */
export interface PanelGeometry {
  /** 左边缘。 */
  left: number;
  /** 上边缘。 */
  top: number;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
}

/**
 * 把宽度夹在「最小宽度」与「最大宽度」之间。
 *
 * @param width 想要的宽度。
 * @param maxWidth 最大宽度（内容区宽；传 `0`/负数 ⇒ 退化成最小宽度）。
 */
export function clampWidth(width: number, maxWidth: number): number {
  const upper = Math.max(AI_WORKSPACE_MIN_WIDTH, Math.floor(maxWidth));
  const lower = AI_WORKSPACE_MIN_WIDTH;
  return Math.min(Math.max(Math.floor(width), lower), upper);
}

/**
 * 把面板夹进视口（**宽度也要重新夹一遍**：视口变窄 ⇒ 面板不能超出屏幕）。
 *
 * @param geometry 想要的几何。
 * @param viewportWidth 视口宽。
 * @param viewportHeight 视口高。
 */
export function clampGeometry(
  geometry: PanelGeometry,
  viewportWidth: number,
  viewportHeight: number,
): PanelGeometry {
  const width = clampWidth(geometry.width, viewportWidth);
  const height = Math.min(
    Math.max(Math.floor(geometry.height), 120),
    Math.max(120, viewportHeight),
  );
  const left = Math.min(
    Math.max(Math.floor(geometry.left), 0),
    Math.max(0, viewportWidth - width),
  );
  const top = Math.min(
    Math.max(Math.floor(geometry.top), 0),
    Math.max(0, viewportHeight - height),
  );
  return { left, top, width, height };
}

/**
 * 校验存储里的几何（**坏了就当没有** ⇒ 不能让一个坏值把界面搞崩）。
 *
 * @param raw 存储里的原始值。
 * @returns 合法就返回几何；不合法 ⇒ `undefined`。
 */
export function parsePanelGeometry(raw: unknown): PanelGeometry | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const numbers = ['left', 'top', 'width', 'height'].map((key) =>
    typeof value[key] === 'number' && Number.isFinite(value[key])
      ? (value[key] as number)
      : Number.NaN,
  );
  if (numbers.some((item) => Number.isNaN(item))) {
    return undefined;
  }
  const [left, top, width, height] = numbers as [
    number,
    number,
    number,
    number,
  ];
  return { left, top, width, height };
}
