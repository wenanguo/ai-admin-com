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
    Buffer.from(env.DSH_AI_SYSTEM_PROMPT, 'base64').toString('utf8'),
    '你是开发 agent',
  );
  // ⚠️ 派活的子代理**没人点同意** ⇒ 不能停在等人批准上
  assert.strictEqual(env.DSH_PERMISSION_MODE, 'danger-full-access');
  assert.strictEqual(env.DSH_AI_PROVIDER, 'deepseek-direct');
  assert.strictEqual(env.DSH_AI_API_KEY, 'k');
  assert.strictEqual(env.DSH_HOME, config.dshHome);
});

test('buildChildEnv：凭据**只**进 DSH_AI_API_KEY（不许漏到别的变量里）', () => {
  const config = dispatchConfig(REPO_ROOT, {});
  const env = buildChildEnv(config, { systemPrompt: 'p', apiKey: 'secret-key' }, {});
  assert.strictEqual(env.DSH_AI_API_KEY, 'secret-key');
  const leaks = Object.entries(env).filter(
    ([name, value]) => name !== 'DSH_AI_API_KEY' && String(value).includes('secret-key'),
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
