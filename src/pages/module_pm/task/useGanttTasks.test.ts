import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from 'vitest-browser-react';
import type { TaskOut } from '@/services/api/pm/task';
import { useGanttTasks } from './useGanttTasks';

/**
 * 甘特数据 hook 的单测。
 *
 * 钉死六件事:
 * 1. 取数:一次拉一页(后端 page_size 上限 100),给了项目就带上 project_id;
 * 2. 映射:行来自映射层,分组行用侧载的项目/里程碑名;
 * 3. 截断:后端总数大于画出来的任务行数 ⇒ truncated(不静默丢);
 * 4. 写回:拖拽后整对象 PUT,**只有起止两个日期变了**,其余字段原样带回;
 * 5. 失败与无效输入都解析成 false(不抛给调用方,错误提示由请求层统一弹);
 * 6. reload 重新取数。
 */

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  updateTask: vi.fn(),
  listProjects: vi.fn(),
  listMilestones: vi.fn(),
}));

vi.mock('@/services/api/pm/task', () => ({
  listTasks: mocks.listTasks,
  updateTask: mocks.updateTask,
}));

vi.mock('@/services/api/pm/project', () => ({
  listProjects: mocks.listProjects,
}));

vi.mock('@/services/api/pm/milestone', () => ({
  listMilestones: mocks.listMilestones,
}));

/** 造一个成功信封(请求层成功时 resolve 的形态) */
function envelope(data: unknown) {
  return {
    code: 0,
    msg: 'ok',
    data,
    status_code: 200,
    success: true,
  };
}

/** 分页结果 */
function page<T>(items: T[], total: number) {
  return {
    items,
    total,
    page_no: 1,
    page_size: 100,
    has_next: total > items.length,
  };
}

/** 一条能画进甘特、也能整对象 PUT 的完整任务 */
function makeTask(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    id: 10,
    project_id: 1,
    milestone_id: 2,
    title: 'A',
    type_code: 'feature',
    status_code: 'in_progress',
    priority_code: 'high',
    start_date: '2026-09-01',
    due_date: '2026-09-12',
    ...overrides,
  };
}

describe('useGanttTasks 甘特数据', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTasks.mockResolvedValue(envelope(page([makeTask()], 1)));
    mocks.updateTask.mockResolvedValue(envelope(makeTask()));
    // 侧载的项目/里程碑名字(useProjectNames 发的请求)
    mocks.listProjects.mockResolvedValue(
      envelope(page([{ id: 1, name: 'Alpha 项目' }], 1)),
    );
    mocks.listMilestones.mockResolvedValue(
      envelope(page([{ id: 2, name: 'M1 里程碑' }], 1)),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('取数', () => {
    it('一次拉一页 100 条(后端 page_size 上限就是 100)', async () => {
      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mocks.listTasks).toHaveBeenCalledTimes(1);
      expect(mocks.listTasks).toHaveBeenCalledWith({
        page_no: 1,
        page_size: 100,
      });
    });

    it('给了项目 id 时,请求参数带上 project_id(后端按项目筛)', async () => {
      const { result } = await renderHook(() =>
        useGanttTasks({ projectId: 7 }),
      );

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mocks.listTasks).toHaveBeenCalledWith({
        page_no: 1,
        page_size: 100,
        project_id: 7,
      });
    });

    it('行来自映射层:分组行用侧载的项目/里程碑名', async () => {
      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.mapping.data).toHaveLength(3);
      });

      expect(result.current.mapping.data.map((row) => row.id)).toEqual([
        'p-1',
        'm-2',
        't-10',
      ]);
      expect(result.current.mapping.data[0].text).toBe('Alpha 项目');
      expect(result.current.mapping.data[1].text).toBe('M1 里程碑');
      // 后端给的总数
      expect(result.current.total).toBe(1);
      expect(result.current.truncated).toBe(false);
    });

    it('后端总数大于画出来的任务行数 ⇒ truncated(不静默丢)', async () => {
      mocks.listTasks.mockResolvedValue(envelope(page([makeTask()], 5)));

      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.total).toBe(5);
      });
      expect(result.current.truncated).toBe(true);
    });

    it('reload 重新取数', async () => {
      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(mocks.listTasks).toHaveBeenCalledTimes(1);

      result.current.reload();

      await vi.waitFor(() => {
        expect(mocks.listTasks).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('applyDateChange 拖拽写回', () => {
    it('成功:整对象 PUT,只有起止两个日期变了', async () => {
      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.mapping.taskCount).toBe(1);
      });

      const ok = await result.current.applyDateChange('t-10', {
        start_date: '2026-09-05',
        end_date: '2026-09-20',
      });

      expect(ok).toBe(true);
      expect(mocks.updateTask).toHaveBeenCalledTimes(1);
      expect(mocks.updateTask).toHaveBeenCalledWith(10, {
        project_id: 1,
        milestone_id: 2,
        title: 'A',
        type_code: 'feature',
        status_code: 'in_progress',
        priority_code: 'high',
        start_date: '2026-09-05',
        due_date: '2026-09-20',
      });
    });

    it('写失败:解析成 false,不抛给调用方(错误提示由请求层统一弹)', async () => {
      mocks.updateTask.mockRejectedValueOnce(new Error('boom'));

      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.mapping.taskCount).toBe(1);
      });

      const ok = await result.current.applyDateChange('t-10', {
        start_date: '2026-09-05',
        end_date: '2026-09-20',
      });

      expect(ok).toBe(false);
    });

    it('行 id 不存在 ⇒ false,不发请求', async () => {
      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.mapping.taskCount).toBe(1);
      });

      const ok = await result.current.applyDateChange('t-999', {
        start_date: '2026-09-05',
        end_date: '2026-09-20',
      });

      expect(ok).toBe(false);
      expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it('分组行 id(不是任务行)⇒ false,不发请求', async () => {
      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.mapping.taskCount).toBe(1);
      });

      const ok = await result.current.applyDateChange('p-1', {
        start_date: '2026-09-05',
        end_date: '2026-09-20',
      });

      expect(ok).toBe(false);
      expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it('日期为空 ⇒ false,不发请求(不发注定 422 的请求)', async () => {
      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.mapping.taskCount).toBe(1);
      });

      const ok = await result.current.applyDateChange('t-10', {
        start_date: '',
        end_date: '2026-09-20',
      });

      expect(ok).toBe(false);
      expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it('原任务缺 PUT 必填字段 ⇒ false,不发请求', async () => {
      mocks.listTasks.mockResolvedValue(
        envelope(page([makeTask({ type_code: undefined })], 1)),
      );

      const { result } = await renderHook(() => useGanttTasks());

      await vi.waitFor(() => {
        expect(result.current.mapping.taskCount).toBe(1);
      });

      const ok = await result.current.applyDateChange('t-10', {
        start_date: '2026-09-05',
        end_date: '2026-09-20',
      });

      expect(ok).toBe(false);
      expect(mocks.updateTask).not.toHaveBeenCalled();
    });
  });
});
