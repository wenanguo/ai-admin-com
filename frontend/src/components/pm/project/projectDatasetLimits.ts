/**
 * **项目数据集的取数上限** —— 数据集与截断提示**共用**的一份数字。
 *
 * ⚠️ 为什么单独一个模块：提示组件（`./ProjectTruncationNotice`）要在文案里
 *   写清「单次上限是多少」，而取数那边（`./useProjectDataset`）要照着它封顶。
 *   两边引同一个常量 ⇒ 数字改一处，两边一起变。
 *
 * ⚠️ 提示组件**不能**从 `./useProjectDataset` 引常量：那个模块被单元测试
 *   整体 mock 掉 ⇒ 常量会跟着消失 ⇒ 组件 import 就炸。
 */

/** 一页拉多少条（后端上限就是 100） */
export const PROJECT_DATASET_PAGE_SIZE = 100;

/** 最多拉多少页（10 页 = 1000 条）—— 数据量再大也不无限拉 */
export const PROJECT_DATASET_MAX_PAGES = 10;

/** 单次取数的条数上限（10 页 × 100 条 = 1000 条） */
export const PROJECT_DATASET_LIMIT =
  PROJECT_DATASET_MAX_PAGES * PROJECT_DATASET_PAGE_SIZE;
