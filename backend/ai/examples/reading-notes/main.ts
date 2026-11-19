/**
 * 示例系统的入口 —— **只通过内核的公开入口接入**。
 *
 * ## 这一步就是「复用」本身
 *
 * ```text
 * 自己的插件  →  pluginRegistry.register(自己的插件)
 * 自己的 YAML  →  <cwd>/agents/<id>/agent.yaml（内核按 cwd 相对找）
 * 自己的服务  →  createCoreApp({ plugins: [自己的插件] })
 * ```
 *
 * ⚠️ **只从 `../../src/core/index.ts` import**（内核的公开入口）
 * ⇒ 不许 import 内核内部路径（`core/session/...` 之类）
 * ⇒ `scripts/check-core-reuse.cjs` 把这条钉死（进 CI）。
 *
 * ## cwd 相对
 *
 * 内核按 **cwd 相对**找智能体配置（`agents/`）与技能（`.pi/skills`）
 * ⇒ 本进程必须在**示例自己的目录**下启动（容器里 WORKDIR=/app，agents/ 也在那）。
 */

import { assertCoreReady, createCoreApp, pluginRegistry } from "../../src/core/index.ts";
import { createNotesPlugin } from "./plugin.ts";
import { listNotes } from "./store.ts";

/** 自己的插件。 */
const plugin = createNotesPlugin();

/**
 * ⚠️ **注册进内核的进程级注册表** ⇒ 运行时（命令目录 / 身份查询）才认得它。
 *    注册表是**懒读**的 ⇒ 什么时候注册都行（但要在装配之前）。
 */
pluginRegistry.register(plugin);

/** 启动自检（配置坏了 / 插件没注册 ⇒ 立刻退出，别等有人来调）。 */
try {
	assertCoreReady();
} catch (error) {
	console.error(
		`[notes] 启动自检不通过，已退出：${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
}

const port = Number(process.env.PORT ?? 3200);

/**
 * 装配服务。
 *
 * - `plugins`：健康检查的探针从插件来（这个示例没有上游 ⇒ 不给探针）；
 * - `configure`：**示例系统自己的业务端点**（内核不懂「笔记」⇒ 归业务系统）
 *   ⇒ 在内核的 404 之前挂 ⇒ 够得着。
 */
const app = createCoreApp({
	plugins: [plugin],
	configure: (app) => {
		app.get("/api/notes", (_req, res) => {
			res.json({ code: 0, msg: "成功", data: listNotes() });
		});
	},
});

const server = app.listen(port, () => {
	console.log(`[notes] 示例系统已启动：http://localhost:${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, () => {
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 5000).unref();
	});
}
