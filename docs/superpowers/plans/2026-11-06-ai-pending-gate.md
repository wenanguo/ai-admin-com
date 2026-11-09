# 待确认闭环实现计划（阶段 3：修改已有数据要人点头）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 想**改**已有数据（`update_task` / `patch_task_status`）时**先挂起**，等人在界面上点「同意」才真执行；点了「拒绝」或超时则不执行，模型会自己告诉用户被拒了。

**Architecture:** 用 pi 的 `tool_call` hook（**async 且被 await**）在**hook 里同步等批准**：命中「修改类工具」⇒ 写 `ai_pending_action` + 推 SSE `pending` 事件 ⇒ `await` 一个「批准信号」；批准 ⇒ hook 放行（pi 照常执行原调用，**那一轮不中断**）；拒绝/超时 ⇒ hook 返回 `{block:true, reason}`（模型收到错误工具结果，自行说明被拒）。

**Tech Stack:** pi SDK（`pi.on("tool_call")`）、Prisma（`ai_pending_action` 表已在）、Next.js Route Handler、vitest；前端：`ai-admin-com`（React 19 + antd 6）

**Spec:** `docs/superpowers/specs/2026-11-06-aipm-mcp-skills-design.md` §6.5（挂起机制）、§8 阶段 3

## Global Constraints

- **只有「修改已有数据」才拦**：`create_*` 一律放行；`update_*` / `patch_*` 才要人点头（用户 2026-11-06 定的口径）。
- **挂起只存内存**（与 token 同规矩）：进程重启 ⇒ 挂起的 await 丢失 ⇒ 那一轮断掉（DB 里那条 pending 仍在，可人工清理）。
- **不注回会话**：靠 hook 的同步挂起 ⇒ 模型那一轮不被打断，也不需要往对话里注入系统消息。
- **超时必须有**：默认 5 分钟（可配 `AI_PENDING_TIMEOUT_MS`）⇒ 超时按「拒绝」处理（宁可不做，也不能无限挂着）。
- **SSE 事件新增第 9 种 `pending`**：现有的 8 种不动；前端要认它。
- 仓内风格：TypeScript、**tab 缩进**、中文注释解释「为什么」；提交信息 conventional commits。
- 验证命令：`npx vitest run` 与 `npx tsc --noEmit`（两个仓都要）。

## Review Focus

1. **挂起期间模型在等** ⇒ 用户在界面上要看得见「等待确认」（不能像卡死）。
2. **拒绝/超时** ⇒ 模型要**明确告诉用户被拒了**（不是静默、不是报错）。
3. **挂起时进程重启** ⇒ 不能让 DB 里的 pending 永远停在 PENDING（要有兜底：读到过期就当拒绝/可清理）。
4. **权限**：批准的人必须是**发起这次对话的用户**（别人不能替别人点同意）。
5. **重复批准** ⇒ 第二次点「同意」不能重复执行（幂等）。

---

### Task 1: 等待者注册表（进程内存）

**Files:**
- Create: `src/agent/pending-waiters.ts`
- Test: `src/agent/pending-waiters.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PendingDecision = "approved" | "rejected" | "timeout";
  export interface PendingWaiter {
    /** 等待者的唯一标识（= pending 行的 id）。 */
    id: string;
    /** 决定 ⇒ 唤醒等待中的 hook。 */
    decide: (decision: PendingDecision) => void;
  }
  export class PendingWaiterRegistry {
    /** 注册一个等待者，返回一个 Promise（批准/拒绝/超时都会 resolve）。 */
    wait(id: string, timeoutMs: number): Promise<PendingDecision>;
    /** 决定（approve/reject 端点调用）。 */
    decide(id: string, decision: PendingDecision): boolean;
    /** 当前有几个在等（自检/健康检查）。 */
    size(): number;
  }
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/agent/pending-waiters.test.ts
import { describe, expect, it } from "vitest";
import { PendingWaiterRegistry } from "./pending-waiters";

describe("待确认等待者", () => {
	it("批准 ⇒ 等待者被唤醒成 approved", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p1", 1000);
		expect(registry.size()).toBe(1);
		expect(registry.decide("p1", "approved")).toBe(true);
		expect(await waiting).toBe("approved");
	});

	it("拒绝 ⇒ 唤醒成 rejected", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p2", 1000);
		registry.decide("p2", "rejected");
		expect(await waiting).toBe("rejected");
	});

	it("超时 ⇒ 唤醒成 timeout（宁可不做）", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p3", 10);
		expect(await waiting).toBe("timeout");
		expect(registry.size()).toBe(0);
	});

	it("对不存在的 id 作决定 ⇒ false（不能凭空唤醒）", () => {
		const registry = new PendingWaiterRegistry();
		expect(registry.decide("nope", "approved")).toBe(false);
	});

	it("重复决定只生效一次（幂等）", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p4", 1000);
		expect(registry.decide("p4", "approved")).toBe(true);
		expect(registry.decide("p4", "rejected")).toBe(false);
		expect(await waiting).toBe("approved");
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/pending-waiters.test.ts`
Expected: FAIL —— `Cannot find module './pending-waiters'`

- [ ] **Step 3: 实现 `src/agent/pending-waiters.ts`**

```ts
/**
 * 待确认的**等待者**（进程内存）。
 *
 * ## 为什么在内存
 *
 * 挂起的是**一个 await** ⇒ 它本来就只能活在进程里（与 token 同规矩）。
 * DB 里那条 `ai_pending_action` 是**给人看的记录**（谁提的、什么时候、批没批），
 * 不是用来恢复挂起的 ⇒ 进程重启后那条记录会停在 PENDING（靠 `expiresAt` 兜底）。
 */

/** 批准的结果。 */
export type PendingDecision = "approved" | "rejected" | "timeout";

/** 一个等待中的批准。 */
interface Waiter {
	/** 唤醒它（只第一次有效）。 */
	resolve: (decision: PendingDecision) => void;
	/** 超时计时器。 */
	timer: ReturnType<typeof setTimeout>;
}

/** 等待者注册表。 */
export class PendingWaiterRegistry {
	readonly #waiters = new Map<string, Waiter>();

	/**
	 * 注册一个等待者。
	 *
	 * @param id pending 行的 id。
	 * @param timeoutMs 超时（毫秒）⇒ 超时按「拒绝」处理。
	 */
	wait(id: string, timeoutMs: number): Promise<PendingDecision> {
		// 同一个 id 只允许一个等待者（重复注册 ⇒ 旧的直接判超时）
		this.#waiters.get(id)?.resolve("timeout");
		return new Promise<PendingDecision>((resolve) => {
			const timer = setTimeout(() => {
				this.#waiters.delete(id);
				resolve("timeout");
			}, timeoutMs);
			this.#waiters.set(id, {
				resolve: (decision) => {
					clearTimeout(timer);
					this.#waiters.delete(id);
					resolve(decision);
				},
				timer,
			});
		});
	}

	/**
	 * 决定（approve / reject 端点调用）。
	 *
	 * @returns 唤醒了一个等待者 ⇒ true；没有 ⇒ false（重复决定、过期、id 不对）。
	 */
	decide(id: string, decision: PendingDecision): boolean {
		const waiter = this.#waiters.get(id);
		if (waiter === undefined) {
			return false;
		}
		waiter.resolve(decision);
		return true;
	}

	/** 当前有几个在等。 */
	size(): number {
		return this.#waiters.size;
	}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/pending-waiters.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add src/agent/pending-waiters.ts src/agent/pending-waiters.test.ts
git commit -m "feat(ai): 待确认等待者注册表（进程内存,带超时）"
```

---

### Task 2: pending 的**写侧**（现在只有读侧）

**Files:**
- Create: `src/pending-write.ts`
- Test: `src/pending-write.test.ts`

**Interfaces:**
- Consumes: Prisma（`ai_pending_action` 表的字段见 `prisma/schema.prisma`）
- Produces:
  ```ts
  export interface CreatePendingInput {
    id?: string;
    conversationId?: string;
    userId: string;
    /** 命令（工具）名。 */
    command: string;
    /** 参数（原样存，脱敏由调用方负责）。 */
    args: Record<string, unknown>;
    /** 给人看的摘要。 */
    preview?: Record<string, unknown>;
    /** 多久算过期（毫秒）。 */
    ttlMs?: number;
  }
  export async function createPendingAction(input: CreatePendingInput): Promise<{ id: string; expiresAt: Date }>;
  export async function resolvePendingAction(id: string, status: "CONFIRMED" | "REJECTED", resolvedBy: string): Promise<boolean>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/pending-write.test.ts
import { describe, expect, it, vi } from "vitest";
import { prisma } from "./db";

vi.mock("./db", () => ({
	prisma: {
		aiPendingAction: { create: vi.fn(), updateMany: vi.fn() },
	},
}));

describe("待确认的写侧", () => {
	it("建一条 pending ⇒ 状态 PENDING、带过期时间", async () => {
		const { createPendingAction } = await import("./pending-write");
		vi.mocked(prisma.aiPendingAction.create).mockResolvedValue({ id: "p1" } as never);

		const result = await createPendingAction({
			userId: "2",
			command: "update_task",
			args: { id: 117, title: "新标题" },
			preview: { title: "新标题" },
			ttlMs: 60_000,
		});

		expect(result.id).toBe("p1");
		const data = vi.mocked(prisma.aiPendingAction.create).mock.calls[0]?.[0]?.data as Record<string, unknown>;
		expect(data["status"]).toBe("PENDING");
		expect(data["command"]).toBe("update_task");
		expect(data["expiresAt"]).toBeInstanceOf(Date);
	});

	it("批准 ⇒ 状态改成 CONFIRMED 并记下是谁批的", async () => {
		const { resolvePendingAction } = await import("./pending-write");
		vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({ count: 1 });

		expect(await resolvePendingAction("p1", "CONFIRMED", "2")).toBe(true);
		const data = vi.mocked(prisma.aiPendingAction.updateMany).mock.calls[0]?.[0]?.data as Record<string, unknown>;
		expect(data["status"]).toBe("CONFIRMED");
		expect(data["resolvedBy"]).toBe("2");
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/pending-write.test.ts`
Expected: FAIL —— `Cannot find module './pending-write'`

- [ ] **Step 3: 实现 `src/pending-write.ts`**

```ts
/**
 * 待确认动作的**写侧**（`ai_pending_action` 表）。
 *
 * ⚠️ 读侧在 `pending-query.ts`；这里补上写侧 —— 「挂起」「批准」「拒绝」。
 *
 * ⚠️ **这不是恢复挂起的地方**：挂起是进程内存里的一个 await
 * （见 `pending-waiters.ts`）⇒ 这张表是**给人看的记录**。
 */

import { prisma } from "./db";

/** 默认多久算过期（毫秒）。 */
export const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1000;

/** 建一条待确认。 */
export async function createPendingAction(input: {
	id?: string;
	conversationId?: string;
	userId: string;
	command: string;
	args: Record<string, unknown>;
	preview?: Record<string, unknown>;
	ttlMs?: number;
}): Promise<{ id: string; expiresAt: Date }> {
	const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_PENDING_TTL_MS));
	const row = await prisma.aiPendingAction.create({
		data: {
			...(input.id === undefined ? {} : { id: input.id }),
			conversationId: input.conversationId ?? null,
			userId: input.userId,
			command: input.command,
			args: input.args as never,
			preview: (input.preview ?? {}) as never,
			status: "PENDING",
			expiresAt,
		},
	});
	return { id: row.id, expiresAt };
}

/**
 * 把一条待确认落定（批准 / 拒绝）。
 *
 * @returns 真的改到了一行 ⇒ true（重复批准 ⇒ false ⇒ **不会重复执行**）。
 */
export async function resolvePendingAction(
	id: string,
	status: "CONFIRMED" | "REJECTED",
	resolvedBy: string,
): Promise<boolean> {
	const result = await prisma.aiPendingAction.updateMany({
		where: { id, status: "PENDING" },
		data: { status, resolvedBy, resolvedAt: new Date() },
	});
	return result.count > 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/pending-write.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pending-write.ts src/pending-write.test.ts
git commit -m "feat(ai): 待确认的写侧（挂起/批准/拒绝）"
```

---

### Task 3: 闸门 —— pi 的 `tool_call` hook

**Files:**
- Create: `src/agent/gate.ts`
- Test: `src/agent/gate.test.ts`
- Modify: `src/agent/pi-session.ts`（挂上这个扩展）

**Interfaces:**
- Consumes: Task 1 的 `PendingWaiterRegistry`；Task 2 的 `createPendingAction`
- Produces:
  ```ts
  /** 这个工具要不要人点头？ */
  export function requiresConfirmation(toolName: string): boolean;
  /** 挂起并等待批准。 */
  export interface GateContext {
    conversationId: string;
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    /** 挂起后通知外界（推 SSE pending 事件）。 */
    onPending: (row: { id: string; command: string; args: Record<string, unknown> }) => void;
  }
  export function createGateExtension(options: {
    waiters: PendingWaiterRegistry;
    timeoutMs?: number;
  }): ExtensionFactory;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/agent/gate.test.ts
import { describe, expect, it, vi } from "vitest";
import { createGateExtension, requiresConfirmation } from "./gate";
import { PendingWaiterRegistry } from "./pending-waiters";

describe("闸门", () => {
	it("只有「修改已有数据」的工具要人点头", () => {
		expect(requiresConfirmation("mcp__aiadmin__update_task")).toBe(true);
		expect(requiresConfirmation("mcp__aiadmin__patch_task_status")).toBe(true);
		expect(requiresConfirmation("mcp__aiadmin__create_task")).toBe(false);
		expect(requiresConfirmation("mcp__aiadmin__list_tasks")).toBe(false);
		expect(requiresConfirmation("load_skill")).toBe(false);
	});

	it("命中修改类工具 ⇒ 挂起并等批准；批准后放行（不 block）", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const extension = createGateExtension({ waiters });

		// 假装 pi 调了 hook
		const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
		const pi = {
			on: (event: string, handler: (e: unknown) => Promise<unknown>) => {
				handlers.set(event, handler);
			},
			registerTool: vi.fn(),
		};
		await extension(pi as never);

		const hook = handlers.get("tool_call");
		expect(hook).toBeDefined();

		const pending = hook?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__update_task",
			toolCallId: "call-1",
			input: { id: 117, title: "新标题" },
		});

		// 挂起了（还没放行）
		await vi.waitFor(() => {
			expect(onPending).not.toHaveBeenCalled();
		});
		// 批准 ⇒ 放行（返回 undefined ⇒ 不 block）
		waiters.decide((onPending.mock.calls[0]?.[0] as { id: string } | undefined)?.id ?? "", "approved");
		expect(await pending).toBeUndefined();
	});

	it("拒绝 ⇒ block，并给出人话原因", async () => {
		const waiters = new PendingWaiterRegistry();
		const extension = createGateExtension({ waiters });
		const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
		await extension({
			on: (event: string, handler: (e: unknown) => Promise<unknown>) => handlers.set(event, handler),
			registerTool: vi.fn(),
		} as never);

		const pending = handlers.get("tool_call")?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__update_task",
			toolCallId: "call-1",
			input: { id: 117 },
		});
		await vi.waitFor(() => {
			expect(waiters.size()).toBe(1);
		});
		waiters.decide([...waiters][0] ?? "", "rejected");
		const result = (await pending) as { block?: boolean; reason?: string } | undefined;
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("拒绝");
	});
});
```

> ⚠️ 实现时注意：`waiters` 只会暴露 `size()`/`decide()`；测试要拿到 pendingId ⇒
> 让 `onPending` 回调把 `{id}` 传出来（实现里 `createPendingAction` 的返回值就是 id）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/gate.test.ts`
Expected: FAIL —— `Cannot find module './gate'`

- [ ] **Step 3: 实现 `src/agent/gate.ts`**

```ts
/**
 * 闸门 —— **修改已有数据要先问人**。
 *
 * ## 机制：pi 的 `tool_call` hook 里**同步等批准**
 *
 * SDK 的 `AgentSession._beforeToolCall` 是 **async 且被 await**
 * ⇒ hook 里可以 await ⇒ 我们就在 hook 里等用户的批准：
 * - **批准** ⇒ hook 返回 `undefined`（不 block）⇒ **pi 照常执行原工具调用**
 *   ⇒ 模型拿到正常结果 ⇒ **那一轮不打断**（不需要往会话里注入系统消息）；
 * - **拒绝/超时** ⇒ hook 返回 `{block:true, reason}` ⇒ 模型收到一个错误工具结果
 *   ⇒ **它会自己告诉用户这次没做成**。
 *
 * ## 只拦「修改已有数据」
 *
 * 用户定的口径（2026-11-06）：**新增放行、修改要点头**。
 * ⇒ 判定：工具名里的 `update_` / `patch_` ⇒ 要点头；其余（`create_` / `list_` / `get_`）放行。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPendingAction } from "../pending-write";
import type { PendingWaiterRegistry } from "./pending-waiters";

/** 默认等多久（毫秒）。 */
export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60 * 1000;

/** 这个工具要不要人点头？ */
export function requiresConfirmation(toolName: string): boolean {
	const bare = toolName.replace(/^mcp__[^_]+__/, "");
	return bare.startsWith("update_") || bare.startsWith("patch_");
}

/** 闸门需要的上下文。 */
export interface GateContext {
	/** 这次对话的 id。 */
	conversationId: string;
	/** 发起人的 id。 */
	userId: string;
	/** 挂起后通知外界（推 SSE pending 事件）。 */
	onPending: (row: { id: string; command: string; args: Record<string, unknown> }) => void;
}

/**
 * 造闸门扩展。
 *
 * @param options 等待者注册表与超时。
 */
export function createGateExtension(options: {
	waiters: PendingWaiterRegistry;
	timeoutMs?: number;
	/** 提供对话上下文（每个会话一份）。 */
	context?: () => GateContext;
}): (pi: ExtensionAPI) => void {
	const timeoutMs = options.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
	return (pi: ExtensionAPI) => {
		pi.on("tool_call", async (event) => {
			if (!requiresConfirmation(event.toolName)) {
				return undefined;
			}
			const context = options.context?.();
			if (context === undefined) {
				// 没有上下文 ⇒ 没法挂起 ⇒ **放行**（别把 AI 卡死）
				return undefined;
			}
			const row = await createPendingAction({
				conversationId: context.conversationId,
				userId: context.userId,
				command: event.toolName,
				args: event.input,
				preview: { tool: event.toolName, args: event.input },
				ttlMs: timeoutMs,
			});
			context.onPending({ id: row.id, command: event.toolName, args: event.input });

			const decision = await options.waiters.wait(row.id, timeoutMs);
			if (decision === "approved") {
				// 放行：pi 照常执行原调用（参数还是模型给的那份）
				return undefined;
			}
			return {
				block: true,
				reason:
					decision === "timeout"
						? "这次修改等了很久都没人确认，已经作废了。"
						: "用户拒绝了这次修改，没有执行。",
			};
		});
	};
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/gate.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/gate.ts src/agent/gate.test.ts
git commit -m "feat(ai): 闸门 —— 修改类工具在 tool_call hook 里等批准"
```

---

### Task 4: 批准 / 拒绝端点 + `pending` SSE 事件

**Files:**
- Create: `src/app/api/agent/pending/[id]/approve/route.ts`
- Create: `src/app/api/agent/pending/[id]/reject/route.ts`
- Modify: `src/agent/events.ts`（新增 `pending` 事件）
- Modify: `src/agent/runtime.ts`（推 pending 事件 + 提供闸门上下文）
- Test: `src/agent/runtime.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `PendingWaiterRegistry`、Task 2 的 `resolvePendingAction`、Task 3 的 `createGateExtension`
- Produces:
  - `POST /api/agent/pending/:id/approve` → `{ id, status: "CONFIRMED" }`
  - `POST /api/agent/pending/:id/reject` → `{ id, status: "REJECTED" }`
  - SSE 事件 `pending`：`{ conversationId, id, command, args, preview }`

- [ ] **Step 1: 写失败测试（runtime 追加）**

```ts
it("挂起修改类工具 ⇒ 推一个 pending 事件", async () => {
	// 造一个运行时，工具是「修改类」的（名字带 update_）
	// 提交命令 ⇒ 等 pending 事件出现
});
```

- [ ] **Step 2: 跑测试确认失败** → 实现 → 通过

- [ ] **Step 3: 实现**

- `events.ts`：加 `PENDING: "pending"` 与载荷 `{conversationId, id, command, args}`。
- `runtime.ts`：
  - 持有 `PendingWaiterRegistry`（进程级单例，与 `agentRuntime` 同级）；
  - `#ensureSession` 时把闸门扩展挂进 `extensionFactories`（与 MCP 扩展一起）；
  - 闸门的 `context()` 提供 `conversationId` / `userId` / `onPending`（`onPending` ⇒ `#publish(channel, PENDING, …)`）。
- 两个端点：取 token ⇒ 解析当前用户 ⇒ `resolvePendingAction(id, "CONFIRMED"/"REJECTED", userId)` ⇒
  `waiters.decide(id, "approved"/"rejected")` ⇒ 返回信封。
  ⚠️ **顺序**：先 `decide`（唤醒 hook）还是先落库？⇒ **先落库再 decide**
  （这样 hook 放行时，DB 里已经是 CONFIRMED；重复点击 ⇒ updateMany count=0 ⇒ 不重复执行）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add src/app/api/agent/pending src/agent/events.ts src/agent/runtime.ts src/agent/runtime.test.ts
git commit -m "feat(ai): 批准/拒绝端点 + pending 事件"
```

---

### Task 5: 前端 —— 「待确认」页签能批准/拒绝

**Files (在 `ai-admin-com` 仓):**
- Modify: `src/services/api/ai/types.ts`（事件联合类型加 `pending`）
- Modify: `src/services/api/ai/sse.ts`（`toAiEvent` 映射 `pending`）
- Modify: `src/services/api/ai/client.ts`（`approveAiPending` / `rejectAiPending`）
- Modify: `src/components/ai-workspace/useAgentStream.ts`（收集 pending 列表）
- Modify: `src/components/ai-workspace/useWorkspace.ts`（透传）
- Modify: `src/components/ai-workspace/PendingPanel.tsx`（同意/拒绝按钮）
- Test: 对应的 `*.test.ts(x)`

- [ ] **Step 1: 写失败测试** → **Step 2: 失败** → **Step 3: 实现** → **Step 4: 通过** → **Step 5: 提交**

（细节与阶段 2 的技能/MCP 任务同构，接口形状见 Task 4 的 Produces。）

---

## 不在本计划范围

- **审计归属**（MCP 工具的写审计在后端）—— 后端的事，见设计文档 §6.6。
- **「用户拒绝」时的模型话术调优** —— hook 的 `reason` 先给一句人话，够用即可。
- **前端「待确认」的历史清理**（过期未处理的行）—— 现在只在读侧过滤 `PENDING`。
