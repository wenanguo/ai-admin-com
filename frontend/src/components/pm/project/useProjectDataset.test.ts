import { describe, expect, it, vi } from 'vitest';
import type { ProjectOut } from '@/services/api/pm/project';
import {
  PROJECT_DATASET_MAX_PAGES,
  PROJECT_DATASET_PAGE_SIZE,
} from './projectDatasetLimits';
import { fetchAllProjects } from './useProjectDataset';

const mocks = vi.hoisted(() => ({ listProjects: vi.fn() }));
vi.mock('@/services/api/pm/project', () => ({
  listProjects: mocks.listProjects,
}));

function envelope(data: unknown) {
  return { code: 0, msg: 'ok', data, status_code: 200, success: true };
}
function project(id: number): ProjectOut {
  return { id, name: `项目 ${id}`, code: `P-${id}` };
}

/** 假后端：按 page_no 切分 all，并记录实际被请求过的页码 */
function fakeBackend(all: ProjectOut[]) {
  const pages: number[] = [];
  mocks.listProjects.mockImplementation(
    async (params: { page_no?: number; page_size?: number }) => {
      const pageNo = params.page_no ?? 1;
      const size = params.page_size ?? 100;
      pages.push(pageNo);
      const start = (pageNo - 1) * size;
      return envelope({
        items: all.slice(start, start + size),
        total: all.length,
      });
    },
  );
  return pages;
}

describe('fetchAllProjects', () => {
  it('总数一页装得下 ⇒ 只发 1 次请求', async () => {
    const pages = fakeBackend([project(1), project(2)]);
    const result = await fetchAllProjects();
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(pages).toEqual([1]);
  });

  it('装不下 ⇒ 把剩下的页并行补齐', async () => {
    const all = Array.from({ length: 250 }, (_, i) => project(i + 1));
    const pages = fakeBackend(all);
    const result = await fetchAllProjects();
    expect(result.items).toHaveLength(250);
    expect(result.total).toBe(250);
    expect(pages).toEqual([1, 2, 3]);
  });

  it('封顶 10 页 ⇒ 只拉 10 页，total 仍是后端说的数', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => project(i + 1));
    const pages = fakeBackend(all);
    const result = await fetchAllProjects();
    expect(result.items).toHaveLength(PROJECT_DATASET_MAX_PAGES * 100);
    expect(result.total).toBe(1200);
    expect(pages).toHaveLength(PROJECT_DATASET_MAX_PAGES);
    // ⚠️ 够不到的那一截是**封顶** ⇒ 提示的措辞要与「去重丢行」分开
    expect(result.capped).toBe(true);
  });

  it('多页里出现同一个 id ⇒ 只留一条', async () => {
    mocks.listProjects.mockImplementation(
      async (params: { page_no?: number; page_size?: number }) => {
        const pageNo = params.page_no ?? 1;
        const items = pageNo === 1 ? [project(1)] : [project(1), project(2)];
        return envelope({ items, total: 3 });
      },
    );
    const result = await fetchAllProjects();
    expect(result.items.map((p) => p.id)).toEqual([1, 2]);
    // ⚠️ 页都拉完了（**不是**封顶）⇒ 是去重丢行 ⇒ 提示的措辞要分开
    expect(result.capped).toBe(false);
    expect(result.duplicates).toBe(1);
  });

  it('真实分页错位（第 2 页重复第 1 页的第一条）⇒ 去重后每个 id 只留一条', async () => {
    const all = Array.from({ length: 150 }, (_, i) => project(i + 1));
    mocks.listProjects.mockImplementation(
      async (params: { page_no?: number; page_size?: number }) => {
        const pageNo = params.page_no ?? 1;
        const size = params.page_size ?? PROJECT_DATASET_PAGE_SIZE;
        const start = (pageNo - 1) * size;
        const items = all.slice(start, start + size);
        // 模拟并发插入导致的分页错位：第 2 页的第一条重复第 1 页的第一条
        if (pageNo === 2 && items.length > 0) {
          items[0] = all[0];
        }
        return envelope({ items, total: all.length });
      },
    );

    const result = await fetchAllProjects();

    const ids = result.items.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === 1)).toHaveLength(1);
  });

  it('排序口径写死在请求里（不靠后端默认值）', async () => {
    fakeBackend([project(1)]);
    await fetchAllProjects();
    expect(mocks.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        page_no: 1,
        page_size: PROJECT_DATASET_PAGE_SIZE,
        order_by: JSON.stringify([{ id: 'desc' }]),
      }),
    );
  });
});
