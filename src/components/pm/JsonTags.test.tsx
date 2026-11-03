import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { renderJsonTags } from './JsonTags';

/**
 * 「JSON 数组字符串 → Tag 串」渲染器的单测。
 *
 * 这段逻辑原先在项目列表页与项目详情页各抄了一份 —— 现在只有这一份实现,
 * 所以坏数据的兜底行为(显示 '-' 而不是冒充数据)在这里一次钉死。
 */
describe('renderJsonTags JSON 数组字符串渲染', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('合法的 JSON 数组字符串渲染成一个个标签', async () => {
    const { getByText } = await render(
      <div>{renderJsonTags('["财务","合规"]')}</div>,
    );

    await expect.element(getByText('财务')).toBeVisible();
    await expect.element(getByText('合规')).toBeVisible();
  });

  it('空值显示占位符', async () => {
    const { getByText } = await render(<div>{renderJsonTags(null)}</div>);

    await expect.element(getByText('-')).toBeVisible();
  });

  it('不是合法 JSON 时显示占位符,不冒充数据', async () => {
    const { getByText } = await render(
      <div>{renderJsonTags('财务,合规')}</div>,
    );

    await expect.element(getByText('-')).toBeVisible();
  });

  it('是 JSON 但不是数组(是对象)时显示占位符', async () => {
    const { getByText } = await render(
      <div>{renderJsonTags('{"tag":"财务"}')}</div>,
    );

    await expect.element(getByText('-')).toBeVisible();
  });

  it('空数组显示占位符', async () => {
    const { getByText } = await render(<div>{renderJsonTags('[]')}</div>);

    await expect.element(getByText('-')).toBeVisible();
  });

  it('数组里混着非字符串元素时只渲染字符串那一部分', async () => {
    const { container } = await render(
      <div>{renderJsonTags('["财务",1,null]')}</div>,
    );

    // 只剩一个标签:非字符串的元素被过滤掉了,不会渲染成 "1" / "null"
    expect(container.querySelectorAll('.ant-tag')).toHaveLength(1);
    expect(container.textContent).toContain('财务');
  });
});
