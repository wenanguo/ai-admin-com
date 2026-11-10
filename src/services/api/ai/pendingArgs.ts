/**
 * 「挂起的写参数」的小工具 —— 从待确认卡片里读出**改的是哪条任务**、**改了哪几个字段**。
 *
 * ## 为什么需要它
 *
 * 写回成功有两路信号：
 *
 * 1. 服务端的 `entity_updated` 事件（SSE）—— 但它**可能丢**
 *    （断线重连时不会重放 ⇒ 用户看到「AI 说改好了，列表却没动」）；
 * 2. **用户点了「确认执行」** —— 这条是**确定**的：点了就说明这条要写。
 *
 * ⇒ 走第 2 路：批准成功后，**由前端自己**告诉任务页「该刷新哪一行」。
 *
 * ## 为什么参数长这样
 *
 * 待确认里的 `args` 是**闸门收窄之后**的那份（AI 服务端落的库）：
 * 基线 + 允许回填的三个字段 ⇒ 里面带着任务 id，也带着新值。
 */

/** 讨论回填允许改的字段（**与 AI 服务端的白名单一致**，见 `agent/context.ts`）。 */
export const AI_WRITABLE_FIELDS = [
  'status_code',
  'actual_hours',
  'description',
] as const;

/** 挂起的一条写操作（只取我们要用的部分）。 */
export interface PendingWriteArgs {
  /** 工具名（可能带 `mcp__<server>__` 前缀）。 */
  command?: string;
  /** 收窄后的参数。 */
  args?: Record<string, unknown>;
}

/**
 * 这条挂起改的是**哪条任务**。
 *
 * @returns 不是任务写操作、或参数里没有 id ⇒ undefined
 */
export function pendingTaskId(
  pending: PendingWriteArgs | undefined,
): number | undefined {
  const args = pending?.args;
  if (!args) {
    return undefined;
  }
  const command = (pending?.command ?? '').replace(/^mcp__[^_]+__/, '');
  if (command !== 'update_task' && command !== 'patch_task_status') {
    return undefined;
  }
  // update_task 用 `id`；patch_task_status 用 `ids`
  const single = args['id'];
  if (typeof single === 'number' && Number.isInteger(single) && single > 0) {
    return single;
  }
  const ids = args['ids'];
  if (Array.isArray(ids) && typeof ids[0] === 'number') {
    return ids[0];
  }
  return undefined;
}

/**
 * 这次改动了**哪几个可写字段**（与基线逐个比）。
 *
 * ⚠️ 挂起的参数是「基线 + 覆盖」⇒ **不能**直接列参数里的可写字段
 *    （那样会显得「三个字段都改了」）⇒ 必须与基线比，**值不同**才算。
 */
export function pendingChangedFields(
  pending: PendingWriteArgs | undefined,
  baseline: Record<string, unknown> | undefined,
): string[] {
  const args = pending?.args;
  if (!args || !baseline) {
    return [];
  }
  const fields: string[] = [];
  for (const field of AI_WRITABLE_FIELDS) {
    if (!(field in args)) {
      continue;
    }
    const before = baseline[field];
    const after = args[field];
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      fields.push(field);
    }
  }
  return fields;
}
