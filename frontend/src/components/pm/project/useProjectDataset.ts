import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ProjectOut } from '@/services/api/pm/project';
import { listProjects } from '@/services/api/pm/project';
import {
  PROJECT_DATASET_MAX_PAGES,
  PROJECT_DATASET_PAGE_SIZE,
} from './projectDatasetLimits';

/**
 * **共享的项目数据集** —— 列表 / 卡片两个视图共用的那一份数据。
 *
 * ## 为什么要有它
 *
 * 以前只有一个视图，切视图 = 重新挂载 + **重新发请求**；加了卡片视图之后，
 * 两个视图各自取数 ⇒ 切一次视图就重新拉一遍 ⇒ 「太慢」。
 *
 * 现在：**页面进入时取一次全量**，两个视图都从这份数据里读 ⇒ 切视图**零请求**。
 *
 * ## 为什么是「全量」而不是一页
 *
 * 后端 `page_size` 上限 100，而卡片视图要一屏排下全部项目。
 * 只取一页 ⇒ 数据集本身就是残缺的（翻不到第 101 条）。
 * ⇒ 这里把**需要的页并行补齐**（第 1 页拿 `total`，剩下的页并发拉）。
 *
 * ⚠️ **封顶 10 页（1000 条）**：数据量再大也不无限拉（那是把后端打爆）。
 * 超了 ⇒ `total > projects.length` ⇒ `truncated` 为真 ⇒ **页面显式提示**
 * （本仓传统：上限不静默）。
 *
 * ## 缓存
 *
 * 用 react-query（umi 插件已装，`config/config.ts` 的 `reactQuery: {}` ⇒ 全局
 * `QueryClientProvider` 已就位）：
 * - `staleTime` 5 分钟 ⇒ **切视图（组件重新挂载）不会触发 refetch**；
 * - `patchProject` 改本地缓存 ⇒ 两个视图立刻一致。
 */

/**
 * 排序口径：**写出来**，不靠后端的默认值。
 *
 * 后端默认是 id 倒序（与现在的项目列表一致），但依赖默认值意味着
 * 「后端哪天改了默认排序，我们才知道」⇒ 显式写死。
 */
const ORDER_BY = JSON.stringify([{ id: 'desc' }]);

/** 数据集的 queryKey */
const QUERY_KEY = ['pm', 'project', 'dataset'] as const;

/** 缓存多久算「新鲜」（新鲜 ⇒ 重新挂载不 refetch） */
const STALE_TIME = 5 * 60 * 1000;

/** 取全量的结果 */
export interface ProjectDatasetPage {
  /** 合并去重后的项目 */
  items: ProjectOut[];
  /** 后端说的总数（可能大于 items.length ⇒ 被封顶截断了） */
  total: number;
  /**
   * 够不到的那一截**是不是**因为撞到了 10 页封顶。
   *
   * - `true` ⇒ 页数用完了（还有更多页没拉）；
   * - `false` ⇒ 页都拉完了，是**去重**丢了几行（后端分页错位）。
   *
   * ⚠️ 这两种原因要用**不同的措辞**提示 ⇒ 页面得知道是哪一种。
   */
  capped: boolean;
  /** 取数时同一个 id 落在多页里 ⇒ 被去重掉的条数 */
  duplicates: number;
}

/**
 * 拉**全部**项目（第 1 页 + 并行补齐剩下的页）。
 *
 * ⚠️ 并行：第 1 页拿到 `total` 才知道要补几页 ⇒ 第 2..N 页是**并发**发的，
 * 不是一页一页等（否则 10 页要等 10 个来回）。
 */
export async function fetchAllProjects(): Promise<ProjectDatasetPage> {
  const base = {
    page_size: PROJECT_DATASET_PAGE_SIZE,
    order_by: ORDER_BY,
  };

  const first = await listProjects({ ...base, page_no: 1 });
  const total = first?.data?.total ?? 0;
  const items: ProjectOut[] = [...(first?.data?.items ?? [])];

  // 后端说有多少条，就补齐到多少条（并发拉，不是一页一页等）。
  // ⚠️ 按**已收到的条数**推进，而不是按 `total / page_size` 算页数：
  //   后端某页没给满（并发写入导致的分页错位）时，按页数算会以为已经拿齐 ⇒ 提前收工；
  //   按实收条数推进 ⇒ 一直补到条数够了为止（仍受 10 页封顶约束）。
  //   注：正常后端（一页满 100 条）下，本算法与 task 版「按页数算」请求的页数完全一致；
  //   分页错位时**不一样** —— 按页数算会以为已经拿齐而提前收工，
  //   本算法按实收条数继续补（可能多发一次请求）⇒ 这正是它存在的理由。
  //   这条差异被 `useProjectDataset.test.ts` 里「total=3 但首页只回 1 条」那条用例钉住
  //   ⇒ 别随手改回按页数算（否则那条用例拿不到第 2 页的数据）。
  let nextPage = 2;
  while (items.length < total && nextPage <= PROJECT_DATASET_MAX_PAGES) {
    const missing = total - items.length;
    const batchSize = Math.min(
      Math.ceil(missing / PROJECT_DATASET_PAGE_SIZE),
      PROJECT_DATASET_MAX_PAGES - nextPage + 1,
    );
    const rest = await Promise.all(
      Array.from({ length: batchSize }, (_, index) =>
        listProjects({ ...base, page_no: nextPage + index }),
      ),
    );
    for (const res of rest) {
      items.push(...(res?.data?.items ?? []));
    }
    nextPage += batchSize;
  }

  // ⚠️ **循环退出时还没取够 ⇒ 撞到了 10 页封顶**（还有页没拉）
  //   （取够了但去重丢了几行 ⇒ 那不是封顶，是分页错位 —— 提示的措辞要分开）
  const capped = items.length < total;

  // ⚠️ **去重**：并发插入会让分页错位（同一页出现两条一样的），
  //   重复的项目在列表里会占两行、在卡片视图里会变成两张卡片 ⇒ 按 id 去重（保留第一次）。
  const seen = new Set<number>();
  const deduped = items.filter((item) => {
    if (item.id == null) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return {
    items: deduped,
    total,
    capped,
    duplicates: items.length - deduped.length,
  };
}

/** useProjectDataset 的返回值 */
export interface ProjectDatasetResult {
  /** 全量项目（可能被 10 页封顶截断 ⇒ 看 `truncated`） */
  projects: ProjectOut[];
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
  /**
   * 够不到的那一截**是不是**因为撞到了 10 页封顶。
   *
   * - `true` ⇒ 封顶；
   * - `false` ⇒ 页都拉完了，是去重丢了几行（后端分页错位）。
   *
   * ⚠️ 两种原因的**措辞不同** ⇒ 提示组件靠它区分（见 ./ProjectTruncationNotice）。
   */
  capped?: boolean;
  /** 取数时被去重掉的条数（后端分页错位时 > 0） */
  duplicates: number;
  /**
   * 数据集的**版本号**（react-query 的 `dataUpdatedAt`）。
   *
   * 数据一变它就变 ⇒ 视图可以拿它当 `params` 的钥匙，
   * 让依赖本地数据的表格重跑一次（ProTable 靠 `params` 变化触发重取）。
   */
  dataUpdatedAt: number;
  /** 重新取数 */
  reload: () => void;
  /**
   * 本地改一条项目（写操作成功后调用）⇒ 两个视图立刻一致。
   *
   * ⚠️ 只改**展示**用的字段（状态、日期…）；服务端才是真相。
   */
  patchProject: (project: ProjectOut) => void;
}

/**
 * 共享的项目数据集。
 *
 * ⚠️ **不传 projectId**：项目清单永远是「全部项目」
 * （项目详情页里没有「项目列表」页签）⇒ 加了就是没人用的参数。
 */
export function useProjectDataset(): ProjectDatasetResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAllProjects,
    staleTime: STALE_TIME,
  });

  const projects = query.data?.items ?? [];

  /** 本地改一条 ⇒ 缓存里的那一条被换掉（两个视图立刻一致） */
  const patchProject = useCallback(
    (project: ProjectOut) => {
      queryClient.setQueryData<ProjectDatasetPage>(QUERY_KEY, (previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          items: previous.items.map((item) =>
            item.id === project.id ? { ...item, ...project } : item,
          ),
        };
      });
    },
    [queryClient],
  );

  const reload = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    projects,
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    truncated: (query.data?.total ?? 0) > projects.length,
    capped: query.data?.capped,
    duplicates: query.data?.duplicates ?? 0,
    dataUpdatedAt: query.dataUpdatedAt,
    reload,
    patchProject,
  };
}
