#!/usr/bin/env node
/**
 * 验收脚本 —— **「pi 拔干净了 + 派活不再靠 pi」**（issue #123）。
 *
 * ## 为什么要有它
 *
 * 「拔 pi」这件事**很容易退回去**：
 * - 有人为了省事又把 `@earendil-works/pi-coding-agent` 加回依赖；
 * - 有人把 `pi-launcher.js` 加回派活器；
 * - 有人 import 了 pi 的类型（⇒ 编译期才发现 ⇒ 太晚）。
 *
 * ⇒ 这条脚本把三件事**钉成可执行的断言**（任何机器 / CI 都能跑，**零依赖**）：
 *
 * 1. **依赖树里没有 pi**（`backend/ai/package.json` 没有 `@earendil-works/pi-*`）；
 * 2. **源码里没有 pi**（`grep -rn "@earendil-works/pi" backend/ai/src` ⇒ 0 命中）；
 * 3. **派活器不再 spawn pi**（`scripts/agent/dispatch.cjs` 里没有 `pi-launcher`）。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/e2e/dispatch-dsh.static.cjs
 * ```
 *
 * 退出码：0 = 全过；1 = 有违规（打印每一条）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const aiRoot = path.join(repoRoot, 'backend', 'ai');

/** 违规清单。 */
const violations = [];

/** 记一条违规。 */
function report(file, detail) {
  violations.push({ file, detail });
}

/** 读文件（不存在 ⇒ 空串）。 */
function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/* ① 依赖树里没有 pi（**直接依赖**）。 */

const manifestPath = path.join(aiRoot, 'package.json');
const manifest = JSON.parse(read(manifestPath) || '{}');
const deps = {
  ...(manifest.dependencies ?? {}),
  ...(manifest.devDependencies ?? {}),
  ...(manifest.peerDependencies ?? {}),
};
for (const name of Object.keys(deps)) {
  if (name.startsWith('@earendil-works/pi')) {
    report(path.relative(repoRoot, manifestPath), `依赖清单里有 pi 的包「${name}」`);
  }
}

/* ② 源码里没有 pi（**含 pi-ai**）。 */

/** 收集目录下的文件。 */
function filesOf(dir, extensions) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...filesOf(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

for (const file of filesOf(path.join(aiRoot, 'src'), ['.ts', '.tsx', '.js', '.mjs', '.cjs'])) {
  const source = fs.readFileSync(file, 'utf8');
  // ⚠️ 只看**真的 import**（字符串里提一句「pi」不算 ⇒ 断言里会写那个名字）。
  const pattern = /(?:from|import|require)\s*\(?\s*["'](@earendil-works\/pi[^"']*)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    report(path.relative(repoRoot, file), `源码里 import 了 pi 的包「${match[1]}」`);
  }
}

/* ③ 派活器不再 spawn pi。 */

const dispatchPath = path.join(repoRoot, 'scripts', 'agent', 'dispatch.cjs');
const dispatchSource = read(dispatchPath);
for (const needle of ['pi-launcher', 'pi-launcher.js', "'.pi', 'agent', 'bin'"]) {
  if (dispatchSource.includes(needle)) {
    report(path.relative(repoRoot, dispatchPath), `派活器里还有 pi 的东西：「${needle}」`);
  }
}

/* ④ 派活器**确实**用 dsh（别把派活弄没了）。 */

const dshDispatchPath = path.join(repoRoot, 'scripts', 'agent', 'lib', 'dsh-dispatch.cjs');
if (!fs.existsSync(dshDispatchPath)) {
  report(path.relative(repoRoot, dshDispatchPath), '派活的 dsh 后端不在');
} else {
  const dshSource = read(dshDispatchPath);
  if (!dshSource.includes('--profile')) {
    report(path.relative(repoRoot, dshDispatchPath), 'dsh 后端没有起 profile（⇒ 派不了活）');
  }
}

/* ⑤ 我们自己的 provider（**不依赖 pi-ai**）。 */

const providerPath = path.join(aiRoot, 'dsh-plugin', 'src', 'provider.js');
const providerSource = read(providerPath);
if (/from\s+['"]@deepseek-ai\/dsh-llm-pi-ai['"]/.test(providerSource)) {
  report(path.relative(repoRoot, providerPath), 'provider 用了 pi-ai 的适配器（D5=A 不许）');
}
if (!providerSource.includes('@deepseek-ai/dsh-llm')) {
  report(path.relative(repoRoot, providerPath), 'provider 不是建在 dsh-llm 的缝上');
}

/* ⑥ 本仓自己的 `.pi/` 开发资产**保留**（提示词与技能）。 */

for (const asset of [
  path.join(repoRoot, '.pi', 'prompts', 'dev.md'),
  path.join(repoRoot, '.pi', 'prompts', 'pm.md'),
  path.join(repoRoot, 'backend', 'ai', '.pi', 'skills'),
]) {
  if (!fs.existsSync(asset)) {
    report(path.relative(repoRoot, asset), '开发资产不见了（提示词 / 技能）');
  }
}

/* ⑦ 技能正文**保留**（提示词资产）。 */

const skillsDir = path.join(aiRoot, '.pi', 'skills');
if (fs.existsSync(skillsDir)) {
  const skills = fs.readdirSync(skillsDir).filter((name) => fs.statSync(path.join(skillsDir, name)).isDirectory());
  if (skills.length === 0) {
    report(path.relative(repoRoot, skillsDir), '技能正文不见了');
  }
}

/* -------------------------------------------------------------- 打印 */

if (violations.length === 0) {
  console.log('✅ pi 拔干净了（依赖 / 源码 / 派活器 / provider / 开发资产）');
  process.exit(0);
}

for (const violation of violations) {
  console.error(`❌ ${violation.file}：${violation.detail}`);
}
console.error(`\n共 ${violations.length} 条违规。`);
process.exit(1);
