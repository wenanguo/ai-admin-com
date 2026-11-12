/**
 * **项目工作台**的视图解析测试。
 *
 * 钉死「认不出来的 `?view=` ⇒ 回落列表」这条口径（与任务工作台同款）：
 * - `card` / `list` ⇒ 原样；
 * - 其它值（`board` / 空串 / `null`）⇒ `list`。
 *
 * ⚠️ `@umijs/max` 被整个 mock 掉：它会把 umi 的构建期依赖（chokidar → fsevents）
 *    一起拖进浏览器测试环境 ⇒ 平台不兼容直接报错。这里只测纯函数，用不到它。
 */
import { describe, expect, it, vi } from 'vitest';
import { parseProjectView } from './ProjectWorkspace';

vi.mock('@umijs/max', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

describe('parseProjectView', () => {
  it('认得出来的值原样返回', () => {
    expect(parseProjectView('list')).toBe('list');
    expect(parseProjectView('card')).toBe('card');
  });

  it('认不出来的值 ⇒ 回落列表', () => {
    expect(parseProjectView('board')).toBe('list');
    expect(parseProjectView('')).toBe('list');
    expect(parseProjectView(null)).toBe('list');
  });
});
