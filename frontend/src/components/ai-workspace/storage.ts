/**
 * AI 工作台的状态持久化（localStorage）。
 *
 * ⚠️ 键名 `aipm.workspace` 是**前端自己**的（规格 §3.1）——
 * AI 服务（`D:/project/ai-admin-ai`）不用浏览器存储 ⇒ 两边不会撞。
 */

import type { PanelGeometry } from './panel-geometry';

/** 工作台状态在 localStorage 里的键。 */
export const WORKSPACE_STORAGE_KEY = 'aipm.workspace';

/**
 * 工作台状态（会话 id 与页签是这一层自己用的，面板开合也是）。
 */
export interface WorkspaceStorage {
  /**
   * 浮层面板是否打开。
   *
   * ⚠️ 以前这里是 `collapsed`（常驻右栏收成 40px 竖条）。
   *    改成浮层后「折叠」没有对应物了 ⇒ 只剩开/关两态。
   *
   * ⚠️ **字段名换了**（`collapsed` → `open`）⇒ 读不到旧值时**当关闭**（`=== true` 才算开）。
   */
  open?: boolean;
  /**
   * 当前选中的页签（`chat` / `pending` / `audit`）。
   *
   * ⚠️ 存的是**字符串**（localStorage 里只有字符串）⇒ 读的时候要**校验**
   *    （见 `src/components/ai-workspace/index.tsx` 的 `readStoredTab`）。
   */
  tab?: string;
  /** 会话 id。 */
  conversationId?: string;
  /**
   * **新会话**用哪个智能体（`GET /api/agents` 里的 id）。
   *
   * ⚠️ 这只是**新建会话时的选择** ⇒ 已经建好的会话不受它影响
   *    （会话自己的智能体在 `ai_conversation.agent_id` 里）。
   * ⚠️ 没有这个值 ⇒ 建会话时**不传** `agentId` ⇒ 服务端用默认智能体。
   */
  agentId?: string;
  /**
   * 窄版面板的**几何**（用户拖出来的位置与宽度）。
   *
   * ⚠️ **可选**：没有这个字段 ⇒ 面板用默认位置（右边 400px、顶到上下沿）。
   *    字段坏了（不是对象 / 数字不对）⇒ 当没有（见 `parsePanelGeometry`），
   *    不能让一个坏值把界面搞崩。
   */
  panel?: PanelGeometry;
}

/**
 * 读工作台状态。
 *
 * 读不到 / 存的不是 JSON ⇒ 当没有（不能让一个坏值把界面搞崩）。
 */
export function readWorkspaceStorage(
  key: string = WORKSPACE_STORAGE_KEY,
): WorkspaceStorage {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as WorkspaceStorage;
  } catch {
    // 存储被禁用 / 值坏了 ⇒ 当没有
    return {};
  }
}

/**
 * 写工作台状态（**合并**写入，不动别的字段）。
 *
 * 合并是必须的：面板开关、页签、会话 id 写在同一个对象里，
 * 各写各的会互相抹掉。
 */
export function writeWorkspaceStorage(
  patch: Partial<WorkspaceStorage>,
  key: string = WORKSPACE_STORAGE_KEY,
): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...readWorkspaceStorage(key), ...patch }),
    );
  } catch {
    // 存不上也不能让界面崩（配额满 / 隐私模式禁用了存储）
  }
}
