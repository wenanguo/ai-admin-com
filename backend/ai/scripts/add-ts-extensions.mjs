/**
 * 一次性迁移工具：给相对 import 补 `.ts` 后缀。
 *
 * ## 为什么需要
 *
 * 产物用 `tsc` 编译成 **ESM**（pi SDK 是 ESM-only，CommonJS require 不了它），
 * 配合 `rewriteRelativeImportExtensions` ⇒ 源码里写 `./x.ts`，编译后是 `./x.js`。
 *
 * Node 的 ESM 解析**必须**带扩展名 ⇒ 源码里的相对 import 也得带。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/add-ts-extensions.mjs          # 改写 src/**
 * node scripts/add-ts-extensions.mjs --check  # 只检查不改（CI 用）
 * ```
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
const CHECK_ONLY = process.argv.includes("--check");

/** 已经有扩展名的，一动不动。 */
const HAS_EXTENSION = /\.(ts|tsx|js|mjs|cjs|json|css)$/;

/** `from "…"` / `import("…")` 里的相对路径。 */
const PATTERN = /((?:from|import)\s*\(?\s*)(["'])(\.[^"']*)\2/g;

/** 递归列出所有 .ts/.tsx 文件。 */
function listFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...listFiles(full));
		} else if (/\.tsx?$/.test(entry)) {
			files.push(full);
		}
	}
	return files;
}

let changed = 0;
const offenders = [];

for (const file of listFiles(ROOT)) {
	const original = readFileSync(file, "utf8");
	const updated = original.replace(PATTERN, (whole, head, quote, path) => {
		if (HAS_EXTENSION.test(path)) {
			return whole;
		}
		return `${head}${quote}${path}.ts${quote}`;
	});
	if (updated === original) {
		continue;
	}
	changed += 1;
	if (CHECK_ONLY) {
		offenders.push(file);
		continue;
	}
	writeFileSync(file, updated, "utf8");
}

if (CHECK_ONLY) {
	if (offenders.length > 0) {
		console.error(`还有 ${offenders.length} 个文件的相对 import 没带 .ts 后缀：`);
		for (const file of offenders) {
			console.error(`  ${file}`);
		}
		process.exit(1);
	}
	console.log("✔ 所有相对 import 都带 .ts 后缀");
} else {
	console.log(`✔ 改写了 ${changed} 个文件`);
}
