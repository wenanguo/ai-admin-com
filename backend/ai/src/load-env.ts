/**
 * **先加载 `.env`，再让别人 import `env.ts`。**
 *
 * ## 为什么要有这个文件
 *
 * `src/env.ts` 在 **import 时**就做校验（缺变量直接报错）⇒
 * 它**必须**在环境变量已经就位之后被加载。
 *
 * ESM 的 import 是**静态提升**的：`main.ts` 里写
 * ```ts
 * import { loadEnvFile } from "./load-env.ts";
 * import { start } from "./server.ts";   // ← 它会 import env.ts
 * ```
 * 实际执行顺序是按 import 顺序**逐个求值** ⇒ `load-env.ts` 先跑 ✔
 * ⇒ `env.ts` 被加载时变量已经就位。
 *
 * ⚠️ 反例（曾经踩过）：把 `process.loadEnvFile()` 写在 `start()` 里 ——
 *    那时 `server.ts`（⇒ `env.ts`）**早就加载完了** ⇒ 兜底形同虚设，
 *    `node dist/main.js`（不带 `--env-file`）会在 import 阶段就炸。
 *
 * ⇒ 这个文件必须是**第一个被 import 的**。
 */

/** 加载 `.env`（没有这个文件也不致命 —— 用进程环境变量）。 */
export function loadEnvFile(): void {
	try {
		process.loadEnvFile?.();
	} catch {
		// 没有 .env ⇒ 用进程环境变量
	}
}

// 副作用式调用：import 这个模块就等于加载了 .env
loadEnvFile();
