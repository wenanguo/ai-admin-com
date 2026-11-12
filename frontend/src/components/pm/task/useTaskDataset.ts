import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { TaskOut } from '@/services/api/pm/task';
import { listTasks } from '@/services/api/pm/task';

/**
 * **共享的任务数据集** —— 列表 / 看板 / 甘特三个视图共用的那一份数据。
 *
 * ## 为什么要有它
 *
 * 以前三个视图是三个页面、各自取数：切一次视图 = 跳路由 + 重新挂载 + **重新发请求**
 * ⇒ 用户说的「太慢」。
 *
 * 现在：**页面进入时取一次全量**，三个视图都从这份数据里读 ⇒ 切视图**零请求**。
 *
 * ## 为什么是「全量」而不是一页
 *
 * 后端 `page_size` 上限 100，而看板/甘特本来就要「全部任务」才画得出来。
 * 只取一页 ⇒ 数据集本身就是残缺的（列表里翻不到第 101 条）。
 * ⇒ 这里把**需要的页并行补齐**（第 1 页拿 `total`，剩下的页并发拉）。
 *
 * ⚠️ **封顶 10 页（1000 条）**：数据量再大也不无限拉（那是把后端打爆）。
 * 超了 ⇒ `total > tasks.length` ⇒ `truncated` 为真 ⇒ **页面显式提示**
 * （本仓传统：上限不静默）。
 *
 * ## 缓存
 *
 * 用 react-query（umi 插件已装，`config/config.ts` 的 `reactQuery: {}` ⇒ 全局
 * `QueryClientProvider` 已就位）：
 * - queryKey 带 `projectId` ⇒ 不同项目的数据各存一份，不会串；
 * - `staleTime` 5 分钟 ⇒ **切视图（组件重新挂载）不会触发 refetch**；
 * - `patchTask` 改本地缓存 ⇒ 三个视图立刻一致（看板拖完状态，列表里就变了）。
 */

/** 一页拉多少条（后端上限就是 100） */
export const TASK_DATASET_PAGE_SIZE = 100;

/** 最多拉多少页（10 页 = 1000 条）—— 数据量再大也不无限拉 */
export const TASK_DATASET_MAX_PAGES = 10;

/**
 * 排序口径：**写出来**，不靠后端的默认值。
 *
 * 后端默认是 id 倒序（与现在的列表/看板/甘特一致），但依赖默认值意味着
 * 「后端哪天改了默认排序，我们才知道」⇒ 显式写死。
 */
const ORDER_BY = JSON.stringify([{ id: 'desc' }]);

/** 数据集的 queryKey 前缀 */
const QUERY_KEY_PREFIX = ['pm', 'task', 'dataset'] as const;

/** 缓存多久算「新鲜」（新鲜 ⇒ 重新挂载不 refetch） */
const STALE_TIME = 5 * 60 * 1000;

/** 取全量的结果 */
export interface TaskDatasetPage {
  /** 合并去重后的任务 */
  items: TaskOut[];
  /** 后端说的总数（可能大于 items.length ⇒ 被封顶截断了） */
  total: number;
}

/**
 * 拉**全部**任务（第 1 页 + 并行补齐剩下的页）。
 *
 * ⚠️ 并行：第 1 页拿到 `total` 才知道要补几页 ⇒ 第 2..N 页是**并发**发的，
 * 不是一页一页等（否则 10 页要等 10 个来回）。
 */
export async function fetchAllTasks(options?: {
  projectId?: number;
}): Promise<TaskDatasetPage> {
  const base = {
    page_size: TASK_DATASET_PAGE_SIZE,
    order_by: ORDER_BY,
    ...(options?.projectId ? { project_id: options.projectId } : {}),
  };

  const first = await listTasks({ ...base, page_no: 1 });
  const total = first?.data?.total ?? 0;
  const items: TaskOut[] = [...(first?.data?.items ?? [])];

  const pages = Math.min(
    Math.ceil(total / TASK_DATASET_PAGE_SIZE),
    TASK_DATASET_MAX_PAGES,
  );

  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        listTasks({ ...base, page_no: index + 2 }),
      ),
    );
    for (const res of rest) {
      items.push(...(res?.data?.items ?? []));
    }
  }

  // ⚠️ **去重**：并发插入会让分页错位（同一页出现两条一样的），
  //   重复的任务在看板里会变成两张卡片、在列表里会占两行 ⇒ 按 id 去重（保留第一次）。
  const seen = new Set<number>();
  const deduped = items.filter((item) => {
    if (item.id == null) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return { items: deduped, total };
}

/** useTaskDataset 的返回值 */
export interface TaskDatasetResult {
  /** 全量任务（可能被 10 页封顶截断 ⇒ 看 `truncated`） */
  tasks: TaskOut[];
  /** 后端说的总数 */
  total: number;
  /** 首屏还在拉 */
  loading: boolean;
  /** 取数失败 */
  error: Error | null;
  /**
   * 后端说的总数比**手上这份**多 ⇒ 有一截没拿到（封顶或后端分页错位）。
   *
   * 页面据此给一条提示 —— **上限不静默**。
   */
  truncated: boolean;
  /** 重新取数 */
  reload: () => void;
  /**
   * 本地改一条任务（写操作成功后调用）⇒ 三个视图立刻一致。
   *
   * ⚠️ 只改**展示**用的字段（状态、日期…）；服务端才是真相。
   */
  patchTask: (task: TaskOut) => void;
}

/**
 * 共享的任务数据集。
 *
 * @param options.projectId 限定到某个项目（项目详情页的任务页签用）
 */
export function useTaskDataset(options?: {
  projectId?: number;
}): TaskDatasetResult {
  const projectId = options?.projectId;
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => [...QUERY_KEY_PREFIX, projectId ?? 'all'] as const,
    [projectId],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAllTasks({ projectId }),
    staleTime: STALE_TIME,
  });

  const tasks = query.data?.items ?? [];

  /** 本地改一条 ⇒ 缓存里的那一条被换掉（三个视图立刻一致） */
  const patchTask = useCallback(
    (task: TaskOut) => {
      queryClient.setQueryData<TaskDatasetPage>(queryKey, (previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          items: previous.items.map((item) =>
            item.id === task.id ? { ...item, ...task } : item,
          ),
        };
      });
    },
    [queryClient, queryKey],
  );

  const reload = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    tasks,
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    truncated: (query.data?.total ?? 0) > tasks.length,
    reload,
    patchTask,
  };
}
