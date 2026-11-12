import { Alert } from 'antd';
import type React from 'react';
import {
  PROJECT_DATASET_LIMIT,
  PROJECT_DATASET_MAX_PAGES,
  PROJECT_DATASET_PAGE_SIZE,
} from './projectDatasetLimits';

/**
 * **取数被截断时的提示** —— 列表视图与卡片视图**共用**这一条。
 *
 * ## 为什么抽成共享组件
 *
 * 以前这段文案在两个视图里各写了一份 ⇒ 改一次要改两处，
 * 而且两份很容易改得不一样（评审就是这么发现「文案在骗用户」的）。
 *
 * ## 文案为什么这么写
 *
 * ⚠️ **上限不静默**（本仓传统）⇒ 被截断时必须提示。
 *
 * ⚠️ 但提示必须**说真话**：
 *   表格的搜索表单与卡片的筛选行都是**本地**筛**同一份** ≤1000 条的数据集
 *   ⇒ 第 M+1 条之后的项目**用任何手段都够不到**。
 *   ⇒ 旧文案「其余请用搜索缩小范围」让用户去做一件做不到的事，
 *      还让用户以为那些项目存在、只是没匹配上。
 *
 * ⇒ 现在只说三件事实：一共多少、加载了多少、够不到的那一截在哪儿。
 */

export interface ProjectTruncationNoticeProps {
  /** 后端说的总数 */
  total: number;
  /** 现在手上加载到的条数 */
  loaded: number;
  /**
   * 够不到的那一截**是怎么来的**：
   * - `true` ⇒ 撞到了 10 页封顶（还有页没拉）；
   * - `false` ⇒ 页都拉完了，是**去重**丢了几行（后端分页错位）；
   * - 不传 ⇒ 分不清 ⇒ 用一句不会误导的通用文案。
   */
  capped?: boolean;
  /** 去重丢了几条（只有 `capped === false` 时用得上） */
  duplicates?: number;
}

/**
 * 取数被截断时的提示条。
 *
 * ⚠️ **没被截断就不渲染**（`loaded >= total` ⇒ 返回 null）
 *    ⇒ 两个视图可以无条件渲染它，不用各自判断「要不要提示」。
 */
export function ProjectTruncationNotice({
  total,
  loaded,
  capped,
  duplicates,
}: ProjectTruncationNoticeProps): React.ReactElement | null {
  // 没截断 ⇒ 没有提示（上限不静默，但没截断时也不该拿提示条噪用户）
  if (loaded >= total) return null;

  /*
    两种原因，措辞不同：
    - 封顶（capped）：页数用完了，还有更多页没拉；
    - 去重丢行（!capped）：页都拉完了，但后端分页错位 ⇒ 同一条落在多页里
      ⇒ 按 id 去重丢了几行 ⇒ 尾部那几条从来没被拿到过。
    分不清（capped 没传）⇒ 不说原因，只说事实。
  */
  const cause =
    capped === true
      ? '（撞到了单次取数上限）'
      : capped === false && duplicates
        ? `（取数时后端分页错位，${duplicates} 条重复被去重）`
        : '';

  const message = `共 ${total} 个项目，单次上限 ${PROJECT_DATASET_MAX_PAGES} 页 × ${PROJECT_DATASET_PAGE_SIZE} 条 = ${PROJECT_DATASET_LIMIT} 条，现在只加载了 ${loaded} 条${cause}。第 ${loaded + 1} 条及之后的项目在列表与卡片视图里都看不到（搜索与筛选只在这 ${loaded} 条里做，搜不到它们）。`;

  return <Alert type="info" showIcon title={message} />;
}
