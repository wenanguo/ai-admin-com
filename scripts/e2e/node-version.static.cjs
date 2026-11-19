/**
 * Node 版本基线断言（issue #128）—— **静态断言**（不需要装任何东西、不需要网络）。
 *
 * ## 为什么要有它
 *
 * 本仓的 Node 基线从 22 升到 **24.9+**（`@deepseek-ai/dsh` 的 engines 要求）。
 * 这个改动散落在 **CI workflow / package.json / Dockerfile / 文档** 四处
 * ⇒ 任何一处漏改，症状都很怪（本地过、CI 挂；或镜像与 CI 装出两棵树）。
 * ⇒ 用一个脚本把「基线」钉死：
 *
 *   1. `.github/workflows/**` 里**没有** `node-version: 22`（含矩阵 `node_version: [22]`）
 *      ⇒ 且所有 setup-node 都指向 24
 *   2. 三个 `package.json`（根 / frontend / backend-ai）的 `engines.node` 都是 `>=24.9.0`
 *      ⇒ 且三个 `package-lock.json` 里根包的 engines 同步（lock 与 package.json 不脱节）
 *   3. 三个 Dockerfile 的 `ARG NODE_VERSION` 都是 24（⇒ 镜像 tag = `node:24-bookworm-slim`）
 *   4. 文档（AGENTS.md / README.md）里**不再**说「Node ≥ 22」
 *   5. **依赖树没变**：三个 lock 与基线分支的 lock 逐字节相同（只差根包的 engines）
 *      ⇒ 这一条直接证明「这不是一次顺手升依赖」
 *
 * 用法：
 *   node scripts/e2e/node-version.static.cjs
 *
 * ⚠️ 第 5 条需要 git 历史（拿基线分支的 lock）⇒ 没有历史时**跳过**（只警告，不失败）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** 仓根（脚本在 `<root>/scripts/e2e/`）。 */
const ROOT = path.resolve(__dirname, '..', '..');

/** 期望的 Node 基线。 */
const NODE_BASELINE = '24';
/** 期望的 engines 声明。 */
const ENGINES = '>=24.9.0';

const failures = [];
let passed = 0;

/** 断言：条件为真。 */
function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failures.push(detail ? `${label} —— ${detail}` : label);
  console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
}

/** 读文件（不存在 ⇒ 抛错，由顶层统一报错退出）。 */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 读 JSON 文件。 */
function readJson(rel) {
  return JSON.parse(read(rel));
}

/** 递归排序对象的键 ⇒ 稳定序列化（比较两份 lock 时不受键顺序影响）。 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

/** 从 git 读某个 ref 下的文件内容；读不到 ⇒ 返回 null。 */
function gitShow(ref, rel) {
  try {
    return execFileSync('git', ['show', `${ref}:${rel}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** 找基线分支（拿来做「依赖树没变」的比对）。找不到 ⇒ null。 */
function findBaseRef() {
  const candidates = [];
  if (process.env.GITHUB_BASE_REF) candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
  candidates.push('origin/main', 'origin/master', 'main', 'master');
  for (const ref of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
        cwd: ROOT,
        stdio: 'ignore',
      });
      return ref;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

// ───────────────────────────── ① CI workflow ─────────────────────────────
console.log('① CI workflow 的 Node 版本');
{
  const dir = path.join(ROOT, '.github', 'workflows');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  let setupNodeCount = 0;

  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const rel = `.github/workflows/${file}`;

    check(
      `${rel}：没有残留的 node-version: 22`,
      !/node-version:\s*22\b/.test(text),
      '还有 node-version: 22',
    );
    check(
      `${rel}：没有残留的矩阵 [22]`,
      !/node_version:\s*\[\s*22\s*\]/.test(text),
      '还有 node_version: [22]',
    );

    // 每个 setup-node 都必须指向 24（要么写死 24，要么走矩阵）
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes('actions/setup-node@')) continue;
      setupNodeCount += 1;
      // setup-node 之后的 `with:` 块里找 node-version（最多往下看 6 行）
      let version = '';
      for (let j = i + 1; j < Math.min(i + 7, lines.length); j += 1) {
        const m = /node-version:\s*(.+)$/.exec(lines[j]);
        if (m) {
          version = m[1].trim();
          break;
        }
      }
      check(
        `${rel}：setup-node 指向 Node ${NODE_BASELINE}`,
        version === NODE_BASELINE || version.includes('matrix.node_version'),
        `node-version 是「${version}」`,
      );
    }
  }
  check('至少有一个 setup-node（防“脚本没跑起来”的假绿）', setupNodeCount > 0);
}

// ───────────────────────────── ② engines 声明 ─────────────────────────────
console.log('② package.json / package-lock.json 的 engines');
{
  const manifests = ['package.json', 'frontend/package.json', 'backend/ai/package.json'];
  const locks = ['package-lock.json', 'frontend/package-lock.json', 'backend/ai/package-lock.json'];

  for (const rel of manifests) {
    const pkg = readJson(rel);
    check(`${rel}：engines.node = ${ENGINES}`, pkg.engines?.node === ENGINES, `实际是 ${pkg.engines?.node}`);
  }
  for (const rel of locks) {
    const lock = readJson(rel);
    check(
      `${rel}：根包 engines.node = ${ENGINES}`,
      lock.packages?.['']?.engines?.node === ENGINES,
      `实际是 ${lock.packages?.['']?.engines?.node}`,
    );
  }
}

// ───────────────────────────── ③ 镜像基础镜像 ─────────────────────────────
console.log('③ Dockerfile 的 NODE_VERSION');
{
  const dockerfiles = [
    'backend/ai/Dockerfile',
    'docker/web/Dockerfile',
    'backend/ai/examples/reading-notes/Dockerfile',
  ];
  for (const rel of dockerfiles) {
    const text = read(rel);
    check(
      `${rel}：ARG NODE_VERSION=${NODE_BASELINE}`,
      new RegExp(`^ARG NODE_VERSION=${NODE_BASELINE}$`, 'm').test(text),
      'ARG NODE_VERSION 不是 24',
    );
  }
}

// ───────────────────────────── ④ 文档 ─────────────────────────────
console.log('④ 文档里的版本说明');
{
  const agents = read('AGENTS.md');
  check('AGENTS.md：写明 Node ≥ 24.9', agents.includes('Node ≥ 24.9'), '没找到「Node ≥ 24.9」');
  check('AGENTS.md：不再说 Node ≥ 22', !agents.includes('Node ≥ 22'), '还有「Node ≥ 22」');

  const readme = read('README.md');
  check('README.md：写明本地需要 Node ≥ 24.9.0', readme.includes('24.9.0'), '没找到 24.9.0');
  check('README.md：写明怎么查版本', readme.includes('node -v'), '没找到「node -v」');
}

// ───────────────────────────── ⑤ 依赖树没变 ─────────────────────────────
console.log('⑤ 依赖树不因升 Node 而变');
{
  const baseRef = findBaseRef();
  if (!baseRef) {
    console.log('  ⚠ 找不到基线分支（git 历史不可用）⇒ 跳过本项（只警告，不失败）');
  } else {
    const locks = ['package-lock.json', 'frontend/package-lock.json', 'backend/ai/package-lock.json'];
    for (const rel of locks) {
      const baseText = gitShow(baseRef, rel);
      if (baseText === null) {
        console.log(`  ⚠ ${rel}：基线分支没有这个文件 ⇒ 跳过`);
        continue;
      }
      const base = JSON.parse(baseText);
      const current = readJson(rel);

      // 只允许「根包的 engines」不同 ⇒ 其余（依赖树）必须逐字段相同
      if (base.packages?.['']) delete base.packages[''].engines;
      if (current.packages?.['']) delete current.packages[''].engines;

      const same = JSON.stringify(stable(base)) === JSON.stringify(stable(current));
      check(
        `${rel}：依赖树与 ${baseRef} 完全一致（只差 engines）`,
        same,
        'lock 里有依赖变动 ⇒ 这不是一次「只换 Node 运行时」的改动',
      );
    }
  }
}

// ───────────────────────────── 汇总 ─────────────────────────────
console.log('');
if (failures.length > 0) {
  console.error(`❌ Node 版本基线断言失败：${failures.length} 项（通过 ${passed} 项）`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ Node 版本基线断言全部通过（${passed} 项）`);
