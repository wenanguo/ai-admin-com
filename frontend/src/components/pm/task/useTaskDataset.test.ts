import { describe, expect, it, vi } from 'vitest';
import type { TaskOut } from '@/services/api/pm/task';
import {
  fetchAllTasks,
  TASK_DATASET_MAX_PAGES,
  TASK_DATASET_PAGE_SIZE,
} from './useTaskDataset';

/**
 * 共享任务数据集的单测。
 *
 * 钉死四件事:
 * 1. **取全量**:第 1 页就够 ⇒ 只发 1 次请求;不够 ⇒ 把剩下的页**并行**补齐;
 * 2. **封顶**:最多 10 页(1000 条)⇒ 1200 条时只拉 10 页,`total` 仍是后端说的数;
 * 3. **去重**:多页里出现同一个 `id` ⇒ 只留一条(并发插入会让分页错位);
 * 4. **排序口径**:请求带 `order_by`（写出来才稳定,不然后端改默认值我们不知道）。
 */

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
}));

vi.mock('@/services/api/pm/task', () => ({
  listTasks: mocks.listTasks,
}));

/** 造一个成功信封 */
function envelope(data: unknown) {
  return { code: 0, msg: 'ok', data, status_code: 200, success: true };
}

/** 造一条任务 */
function task(id: number): TaskOut {
  return { id, title: `任务 ${id}`, status_code: 'todo' };
}

/**
 * 假后端:按 `page_no` 切分 `all`,`total` 是它一共多少条。
 *
 * ⚠️ `pages` 记录了**实际被请求过的页码**,用来断言「只发了几次请求」。
 */
function fakeBackend(all: TaskOut[]) {
  const calls: number[] = [];
  mocks.listTasks.mockImplementation(async (params: { page_no?: number }) => {
    const pageNo = params.page_no ?? 1;
    calls.push(pageNo);
    const start = (pageNo - 1) * TASK_DATASET_PAGE_SIZE;
    const items = all.slice(start, start + TASK_DATASET_PAGE_SIZE);
    return envelope({
      items,
      total: all.length,
      page_no: pageNo,
      page_size: TASK_DATASET_PAGE_SIZE,
      has_next: start + items.length < all.length,
    });
  });
  return calls;
}

describe('fetchAllTasks', () => {
  it('第一页就够 ⇒ 只发一次请求', async () => {
    const all = Array.from({ length: 93 }, (_, i) => task(i + 1));
    const calls = fakeBackend(all);

    const res = await fetchAllTasks();

    expect(calls).toEqual([1]);
    expect(res.items).toHaveLength(93);
    expect(res.total).toBe(93);
  });

  it('不够 ⇒ 把剩下的页并行补齐', async () => {
    const all = Array.from({ length: 250 }, (_, i) => task(i + 1));
    const calls = fakeBackend(all);

    const res = await fetchAllTasks();

    // 250 条 ⇒ 3 页
    expect(calls.sort()).toEqual([1, 2, 3]);
    expect(res.items).toHaveLength(250);
    expect(res.total).toBe(250);
  });

  it('超过 10 页 ⇒ 封顶不��停', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => task(i + 1));
    const calls = fakeBackend(all);

    const res = await fetchAllTasks();

    expect(calls).toHaveLength(TASK_DATASET_MAX_PAGES);
    expect(res.items).toHaveLength(
      TASK_DATASET_MAX_PAGES * TASK_DATASET_PAGE_SIZE,
    );
    // ⚠️ total 仍是后端说的数（页面据此提示「被截断了」）
    expect(res.total).toBe(1200);
  });

  it('多页里出现同一个 id ⇒ 只留一条', async () => {
    const all = Array.from({ length: 150 }, (_, i) => task(i + 1));
    const calls = fakeBackend(all);
    // 让第 2 页返回第 1 页的第一条（模拟并发插入导致的分页错位）
    mocks.listTasks.mockImplementation(async (params: { page_no?: number }) => {
      const pageNo = params.page_no ?? 1;
      calls.push(pageNo);
      const start = (pageNo - 1) * TASK_DATASET_PAGE_SIZE;
      const items = all.slice(start, start + TASK_DATASET_PAGE_SIZE);
      if (pageNo === 2 && items.length > 0) {
        items[0] = all[0];
      }
      return envelope({
        items,
        total: all.length,
        page_no: pageNo,
        page_size: TASK_DATASET_PAGE_SIZE,
        has_next: false,
      });
    });

    const res = await fetchAllTasks();

    const ids = res.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('请求带 order_by（写出来才稳定）', async () => {
    fakeBackend([task(1)]);
    await fetchAllTasks({ projectId: 3 });
    expect(mocks.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        page_no: 1,
        page_size: TASK_DATASET_PAGE_SIZE,
        project_id: 3,
        order_by: JSON.stringify([{ id: 'desc' }]),
      }),
    );
  });
});
