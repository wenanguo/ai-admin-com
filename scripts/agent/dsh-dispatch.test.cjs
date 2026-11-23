/**
 * `scripts/agent/lib/dsh-dispatch.cjs` 的单元测试（node:test，零依赖、不联网）。
 *
 * ## 为什么要有它
 *
 * 派活机制**从 pi 换成了 dsh**（issue #123）⇒ 这段代码决定：
 * - 起的是**哪个**运行时（dsh ⇒ 不是 pi）；
 * - 模型走**我们自己的 provider**（⇒ 不依赖 pi-ai）；
 * - 系统提示词是**我们的开发流程**（`.pi/prompts/dev.md` ⇒ 保留）。
 *
 * 这三件事一旦被改错 ⇒ 派活会「安静地跑偏」（用错提示词 / 用错模型）⇒ 必须有测试兜住。
 *
 * ## 跑法
 *
 * ```bash
 * node --test scripts/agent/*.test.cjs
 * ```
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildChildEnv,
  dispatchConfig,
  ensureDispatchProfile,
  pluginFingerprint,
  profileManifest,
  profilePatch,
  resolveApiKey,
  resolveDshBin,
} = require('./lib/dsh-dispatch.cjs');

/** 仓根目录（脚本在仓里跑）。 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('dispatchConfig：缺省值（**我们自己的 provider** ⇒ 不是 pi 的 provider/model）', () => {
  const config = dispatchConfig(REPO_ROOT, {});
  // ⚠️ **手里没 key 时**的缺省：DeepSeek 官方（与服务本体一致 ⇒ 一把 key 两处用）。
  assert.strictEqual(config.provider, 'deepseek-direct');
  assert.strictEqual(config.model, 'deepseek-chat');
  assert.strictEqual(config.profile, 'dispatch');
  assert.strictEqual(config.baseURL, 'https://api.deepseek.com/v1');
  // ⚠️ dsh 的 home 在 `.scratch` 下 ⇒ 不进 git
  assert.ok(config.dshHome.includes(path.join('.scratch', 'dispatch')));
  // ⚠️ 系统提示词还是**我们的开发流程**（`.pi/` 是我们的资产 ⇒ 保留）
  assert.strictEqual(config.promptPath, path.join(REPO_ROOT, '.pi', 'prompts', 'dev.md'));
});

test('dispatchConfig：**按手里有什么 key 选路由**（只有 MiniMax ⇒ minimax）', () => {
  const config = dispatchConfig(REPO_ROOT, { MINIMAX_CN_API_KEY: 'mm' });
  assert.strictEqual(config.provider, 'minimax');
  assert.strictEqual(config.model, 'MiniMax-M3');
  assert.strictEqual(config.baseURL, 'https://api.minimaxi.com/v1');
});

test('dispatchConfig：有 DeepSeek key ⇒ 官方路由（两个 key 都在也优先它）', () => {
  const config = dispatchConfig(REPO_ROOT, {
    DEEPSEEK_API_KEY: 'ds',
    MINIMAX_CN_API_KEY: 'mm',
  });
  assert.strictEqual(config.provider, 'deepseek-direct');
  assert.strictEqual(config.model, 'deepseek-chat');
  assert.strictEqual(config.baseURL, 'https://api.deepseek.com/v1');
});

test('dispatchConfig：显式 provider ⇒ **模型与地址跟着换**（不许配错）', () => {
  const config = dispatchConfig(REPO_ROOT, {
    DEEPSEEK_API_KEY: 'ds',
    DISPATCH_PROVIDER: 'minimax',
  });
  assert.strictEqual(config.provider, 'minimax');
  assert.strictEqual(config.model, 'MiniMax-M3');
  assert.strictEqual(config.baseURL, 'https://api.minimaxi.com/v1');
});

test('dispatchConfig：环境变量覆盖（换厂商只改配置）', () => {
  const config = dispatchConfig(REPO_ROOT, {
    DISPATCH_PROVIDER: 'deepseek',
    DISPATCH_MODEL: 'deepseek-chat',
    DISPATCH_BASE_URL: 'https://api.deepseek.com/v1',
    DISPATCH_DSH_PROFILE: 'other',
  });
  assert.strictEqual(config.provider, 'deepseek');
  assert.strictEqual(config.model, 'deepseek-chat');
  assert.strictEqual(config.baseURL, 'https://api.deepseek.com/v1');
  assert.strictEqual(config.profile, 'other');
});

test('resolveDshBin：`DISPATCH_DSH_BIN` 优先', () => {
  assert.strictEqual(
    resolveDshBin(REPO_ROOT, { DISPATCH_DSH_BIN: '/tmp/dsh.js' }),
    '/tmp/dsh.js',
  );
});

test('profileManifest：bundle 里有 dsh-base 与 headless（**一次性任务模式**）', () => {
  const manifest = profileManifest('dispatch');
  assert.deepStrictEqual(manifest.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-headless',
  ]);
  assert.strictEqual(manifest.name, 'dsh-profile-dispatch');
});

test('profilePatch：插我们的插件 + 指定模型路由（**provider 名要对得上**）', () => {
  const config = dispatchConfig(REPO_ROOT, { DISPATCH_PROVIDER: 'minimax' });
  const patch = profilePatch(config);
  assert.ok(patch.includes("name: '@ai-admin/dsh-plugin'"));
  assert.ok(patch.includes('provider: minimax'));
  assert.ok(patch.includes('model: MiniMax-M3'));
});

test('buildChildEnv：系统提示词是 base64 的**开发流程** + 权限是「不等人」', () => {
  const config = dispatchConfig(REPO_ROOT, {});
  const env = buildChildEnv(config, { systemPrompt: '你是开发 agent', apiKey: 'k' }, {});
  assert.strictEqual(
    Buffer.from(env.AI_DSH_SYSTEM_PROMPT, 'base64').toString('utf8'),
    '你是开发 agent',
  );
  // ⚠️ 派活的子代理**没人点同意** ⇒ 不能停在等人批准上
  assert.strictEqual(env.DSH_PERMISSION_MODE, 'danger-full-access');
  assert.strictEqual(env.AI_DSH_PROVIDER, 'deepseek-direct');
  assert.strictEqual(env.AI_DSH_API_KEY, 'k');
  assert.strictEqual(env.DSH_HOME, config.dshHome);
});

test('buildChildEnv：凭据**只**进 AI_DSH_API_KEY（不许漏到别的变量里）', () => {
  const config = dispatchConfig(REPO_ROOT, {});
  const env = buildChildEnv(config, { systemPrompt: 'p', apiKey: 'secret-key' }, {});
  assert.strictEqual(env.AI_DSH_API_KEY, 'secret-key');
  const leaks = Object.entries(env).filter(
    ([name, value]) => name !== 'AI_DSH_API_KEY' && String(value).includes('secret-key'),
  );
  assert.deepStrictEqual(leaks, []);
});

test('resolveApiKey：环境变量优先', () => {
  const config = dispatchConfig(REPO_ROOT, { DISPATCH_API_KEY: 'from-env' });
  assert.strictEqual(resolveApiKey(config, { DISPATCH_API_KEY: 'from-env' }), 'from-env');
});

test('resolveApiKey：**不再**借 pi 的 auth.json（派活彻底不碰 pi 的任何东西）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-home-'));
  fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.pi', 'agent', 'auth.json'),
    JSON.stringify({ 'minimax-cn': { type: 'api_key', key: 'borrowed' } }),
    'utf8',
  );
  const config = dispatchConfig(REPO_ROOT, {});
  const key = resolveApiKey(config, { HOME: home, USERPROFILE: home });
  // ⚠️ issue #123 收尾：连**凭据文件**也不借 ⇒ 「不要 pi」更彻底。
  assert.strictEqual(key, '');
});

test('resolveApiKey：什么都没有 ⇒ 空串（**不猜**）', () => {
  const config = dispatchConfig(REPO_ROOT, {});
  const key = resolveApiKey(config, { HOME: path.join(os.tmpdir(), 'nope-not-here') });
  assert.strictEqual(key, '');
});

/* ------------------------------------------------------------------ *
 * issue #158：profile 里那份插件拷贝**要跟着插件变**。
 *
 * 旧判据是「**依赖已经是这个路径 ⇒ 直接跳过**」⇒ `pnpm add file:` 拷进去的
 * 永远是旧拷贝 ⇒ 我们把 `DSH_AI_*` 改名成 `AI_DSH_*` ⇒ dsh 报
 * `NO_ADAPTER: no adapter registered for provider "minimax"` ⇒ 派活瘫。
 * ------------------------------------------------------------------ */

/** 假 pnpm 的源码（**模仿 pnpm 的 `file:` 拷贝** ⇒ 不联网、不装真依赖）。 */
const FAKE_PNPM = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const arg = args.find((a) => a.includes('@file:')) || '';
const at = arg.indexOf('@file:');
const spec = at >= 0 ? arg.slice(at + 1) : '';
const source = spec.startsWith('file:') ? spec.slice('file:'.length) : '';
const target = path.join(process.cwd(), 'node_modules', '@ai-admin', 'dsh-plugin');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
if (source) {
  fs.cpSync(source, target, { recursive: true });
}
const manifestPath = path.join(process.cwd(), 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.dependencies = manifest.dependencies || {};
manifest.dependencies['@ai-admin/dsh-plugin'] = spec;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n');
if (process.env.FAKE_PNPM_LOG) {
  fs.appendFileSync(process.env.FAKE_PNPM_LOG, spec + '\\n');
}
`;

/** 装「假 pnpm」并把它放到 PATH 前面（**我们的代码起的就是它**）。 */
function installFakePnpm(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-pnpm.cjs'), FAKE_PNPM);
  if (process.platform === 'win32') {
    // ⚠️ Windows 上 `.cmd` 才能被 shell 找到（PATHEXT）。
    fs.writeFileSync(
      path.join(binDir, 'pnpm.cmd'),
      '@echo off\r\nnode "%~dp0fake-pnpm.cjs" %*\r\n',
    );
    return;
  }
  const shim = path.join(binDir, 'pnpm');
  fs.writeFileSync(shim, '#!/bin/sh\nexec node "$(dirname "$0")/fake-pnpm.cjs" "$@"\n');
  fs.chmodSync(shim, 0o755);
}

/** 造一个「插件目录」（**内容可控** ⇒ 改内容就是改插件）。 */
function makePlugin(dir, content) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({
      name: '@ai-admin/dsh-plugin',
      version: '0.0.0',
      private: true,
      type: 'module',
      main: 'src/index.js',
    })}\n`,
  );
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), content);
  return dir;
}

/** 假 pnpm 被叫了几次（**每次记一行**）。 */
function pnpmCalls(work) {
  const log = path.join(work, 'pnpm.log');
  if (!fs.existsSync(log)) {
    return [];
  }
  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

/** 在**假 pnpm** 环境里跑一段验收（**跑完把 PATH 与环境变量还回去**）。 */
function withFakePnpm(run) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-profile-'));
  const originalPath = process.env.PATH;
  try {
    installFakePnpm(path.join(work, 'bin'));
    process.env.PATH = `${path.join(work, 'bin')}${path.delimiter}${originalPath ?? ''}`;
    process.env.FAKE_PNPM_LOG = path.join(work, 'pnpm.log');
    run(work);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    delete process.env.FAKE_PNPM_LOG;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 造一份派活配置（**指向临时目录** ⇒ 不碰真的 `.scratch`）。 */
function dispatchConfigIn(work, pluginDir) {
  const config = dispatchConfig(REPO_ROOT, {
    DISPATCH_DSH_HOME: path.join(work, 'dsh-home'),
    DISPATCH_DSH_PROFILE: 'dispatch',
  });
  config.pluginPath = pluginDir;
  return config;
}

/** profile 里那份拷贝。 */
function copiedFile(config) {
  return path.join(
    config.dshHome,
    'profiles',
    config.profile,
    'node_modules',
    '@ai-admin',
    'dsh-plugin',
    'src',
    'index.js',
  );
}

test('ensureDispatchProfile：**插件内容改了 ⇒ profile 里的拷贝跟着变**', () => {
  withFakePnpm((work) => {
    const pluginDir = makePlugin(path.join(work, 'plugin'), "export const v = 'v1';\n");
    const config = dispatchConfigIn(work, pluginDir);

    ensureDispatchProfile(config);
    assert.ok(fs.readFileSync(copiedFile(config), 'utf8').includes('v1'));

    // ⚠️ **改插件**（这次的真事：把 `DSH_AI_*` 改名成 `AI_DSH_*`）。
    fs.writeFileSync(path.join(pluginDir, 'src', 'index.js'), "export const v = 'v2';\n");
    ensureDispatchProfile(config);

    assert.ok(fs.readFileSync(copiedFile(config), 'utf8').includes('v2'));
    assert.strictEqual(pnpmCalls(work).length, 2);
  });
});

test('ensureDispatchProfile：**内容没变 ⇒ 不重装**（pnpm 装东西要联网、要时间）', () => {
  withFakePnpm((work) => {
    const pluginDir = makePlugin(path.join(work, 'plugin'), "export const v = 'v1';\n");
    const config = dispatchConfigIn(work, pluginDir);

    ensureDispatchProfile(config);
    ensureDispatchProfile(config);
    ensureDispatchProfile(config);

    assert.strictEqual(pnpmCalls(work).length, 1);
  });
});

test('ensureDispatchProfile：profile 里的拷贝**被人删了** ⇒ 重新装', () => {
  withFakePnpm((work) => {
    const pluginDir = makePlugin(path.join(work, 'plugin'), "export const v = 'v1';\n");
    const config = dispatchConfigIn(work, pluginDir);

    ensureDispatchProfile(config);
    fs.rmSync(path.join(config.dshHome, 'profiles', 'dispatch', 'node_modules'), {
      recursive: true,
      force: true,
    });
    ensureDispatchProfile(config);

    assert.strictEqual(pnpmCalls(work).length, 2);
    assert.ok(fs.readFileSync(copiedFile(config), 'utf8').includes('v1'));
  });
});

test('pluginFingerprint：固定 fixture ⇒ 固定的值（**与服务侧算出同一个**）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-fingerprint-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"@ai-admin/dsh-plugin"}');
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'export const v = 1;\n');
    assert.strictEqual(
      pluginFingerprint(dir),
      '9eb235d32ae23284a9c39f672e2a298c616e8e4ba9409ae4a90a4fc11c0cc9ff',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pluginFingerprint：插件目录不在 ⇒ **说清怎么办**（别让 ENOENT 飘出去）', () => {
  assert.throws(
    () => pluginFingerprint(path.join(os.tmpdir(), 'nope-not-here')),
    /找不到我们的插件目录/,
  );
});
