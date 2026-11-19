/**
 * 命令桥 —— dsh 侧插件回调我们执行命令的**内部端点**。
 *
 * ⚠️ **不在对外契约里**（`core/routes/contract.ts` 一个字没动 ⇒ 前端零改动）。
 */

import { describe, expect, it } from "vitest";
import express from "express";
import { createDshBridgeRouter } from "./bridge.ts";

/** 起一个临时的服务（**用真实的 HTTP 打一遍**）。 */
async function withBridge(
	secret: string,
	execute: (input: {
		conversationId: string;
		tool: string;
		args: Record<string, unknown>;
	}) => Promise<{ ok: boolean; summary: string; details?: unknown }>,
	run: (url: string) => Promise<void>,
): Promise<void> {
	const app = express();
	app.use(express.json());
	app.use("/internal/dsh", createDshBridgeRouter({ secret, execute }));
	const server = app.listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	const address = server.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;
	try {
		await run(`http://127.0.0.1:${port}/internal/dsh/commands`);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

describe("命令桥", () => {
	it("密钥不对 ⇒ 401（**别的进程调不动**）", async () => {
		await withBridge(
			"right-secret",
			async () => ({ ok: true, summary: "不该被调用" }),
			async (url) => {
				const response = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json", "x-dsh-bridge-secret": "wrong-secret" },
					body: JSON.stringify({ conversationId: "conv-1", tool: "create_task", args: {} }),
				});
				expect(response.status).toBe(401);
			},
		);
	});

	it("密钥对 ⇒ 执行命令并把结果回给 dsh", async () => {
		await withBridge(
			"right-secret",
			async (input) => ({
				ok: true,
				summary: `建好了：${input.tool}`,
				details: { title: input.args["title"] },
			}),
			async (url) => {
				const response = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json", "x-dsh-bridge-secret": "right-secret" },
					body: JSON.stringify({
						conversationId: "conv-1",
						tool: "create_task",
						args: { title: "写文档" },
					}),
				});
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					ok: true,
					summary: "建好了：create_task",
					details: { title: "写文档" },
				});
			},
		);
	});

	it("载荷不完整 ⇒ 400（**不许瞎执行**）", async () => {
		await withBridge(
			"right-secret",
			async () => ({ ok: true, summary: "不该被调用" }),
			async (url) => {
				const response = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json", "x-dsh-bridge-secret": "right-secret" },
					body: JSON.stringify({ tool: "create_task" }),
				});
				expect(response.status).toBe(400);
			},
		);
	});
});
