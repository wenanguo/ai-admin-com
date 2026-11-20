/**
 * 派活的 **dsh 后端** —— 起一个「干一件活的子代理」（issue #123：派活脱离 pi）。
 *
 * ## 为什么是 dsh
 *
 * 以前派活是 `pi -p "<任务>" --append-system-prompt .pi/prompts/dev.md`
 * ⇒ 派活机制**长在 pi 上** ⇒ 拔 pi 就派不了活。
 *
 * ⇒ 现在用 **DeepSeek Harness（dsh）的 headless 模式**：
 * `dsh --profile dispatch "<任务>"` —— **同构替代**：
 * - 一个进程跑一个任务 ⇒ 跑完打印最终答复 ⇒ 退出（与 pi 的 print 模式一样）；
 * - 工作目录 = 子会话的工作区（隔离）；
 * - 系统提示词 = 我们的开发流程提示词（`.pi/prompts/dev.md`）。
 *
 * ⚠️ **spec §2.8 的结论**：`dsh-subagent-dsh-sdk`（每个任务一个 dsh 子进程）
 *    是同构替代；**headless profile 是它的等价形态**（同一个 dsh 运行时，
 *    只是用「一次性任务」的入口）⇒ 选它是因为**改动最小**：
 *    我们自己的编排外壳（认领 / 工作区 / 状态回写 / 审计）全部不变。
 *
 * ## 模型：**我们自己的 provider**（不依赖 pi-ai）
 *
 * 派活用的 provider 是 `backend/ai/dsh-plugin` 里**我们自己写**的那个
 * （OpenAI 兼容协议 ⇒ DeepSeek / MiniMax 都能用）⇒ **不碰 pi-ai**。
 *
 * ## 配置（环境变量 ⇒ 凭据不落盘）
 *
 * | 变量 | 缺省 | 干什么 |
 * | ---- | ---- | ------ |
 * | `DISPATCH_DSH_BIN` | 仓里 `backend/ai/node_modules/@deepseek-ai/dsh/lib/bin.js` | dsh 运行时 |
 * | `DISPATCH_DSH_HOME` | `<repo>/.scratch/dispatch/dsh-home` | dsh 的 home（profile / 会话） |
 * | `DISPATCH_DSH_PROFILE` | `dispatch` | 派活用的 profile 名 |
 * | `DISPATCH_PROVIDER` | `minimax` | provider 路由名（我们自己的那个） |
 * | `DISPATCH_MODEL` | `MiniMax-M3.1-Flash` | 模型 id |
 * | `DISPATCH_BASE_URL` | `https://api.minimaxi.com/v1` | OpenAI 兼容的根地址 |
 * | `DISPATCH_API_KEY` | —— | 模型 key（**只在环境变量里**） |
 * | `DISPATCH_API_KEY_ENV` | `DISPATCH_API_KEY` | key 放在哪个环境变量里 |
 *
 * ⚠️ **过渡期**：key 还没挪走时，允许从 pi 的 `auth.json` 里借**凭据**
 *    （**只借凭据，不依赖它的代码** ⇒ 依赖树里没有 pi）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

/** 我们插件的包名（**装进 dsh profile 的那个名字**）。 */
const DSH_PLUGIN_PACKAGE = '@ai-admin/dsh-plugin';

/** profile 里要用的 bundle（**dsh 自带** ⇒ 从 dsh 安装里解析）。 */
const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'];

/**
 * 找 dsh 的可执行文件（**JS 入口** ⇒ 用 node 起）。
 *
 * ⚠️ 顺序：`DISPATCH_DSH_BIN` ⇒ 仓里 `backend/ai/node_modules` ⇒ PATH 上的 `dsh`。
 *
 * @param {string} repoRoot 仓根目录。
 * @param {NodeJS.ProcessEnv} env 环境变量。
 * @returns {string} dsh 的 JS 入口路径（找不到 ⇒ 空串）。
 */
function resolveDshBin(repoRoot, env = process.env) {
  const explicit = env.DISPATCH_DSH_BIN;
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  const candidates = [
    path.join(repoRoot, 'backend', 'ai', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * **加载 `backend/ai/.env`**（⇒ 凭据只写一份，服务与派活都用它）。
 *
 * ## 为什么
 *
 * 服务本体读 `backend/ai/.env`（`src/core/env/load-env.ts`）⇒ key 放在那儿。
 * 但派活器是**另一个进程**（`scripts/agent/dispatch.cjs`）⇒ 原来只看**自己的环境变量**
 * ⇒ 要么用户得把 key 导进 OS 环境变量（⇒ 换台机器就断），要么每个进程各配一份。
 *
 * ⇒ 这里也读同一个 `.env` ⇒ **一处写，两处用**。
 *
 * ⚠️ **不覆盖**已存在的环境变量（`process.loadEnvFile` 的行为）⇒
 *    CI / 临时覆盖（`DISPATCH_API_KEY=xxx node …`）仍然优先。
 *
 * @param {string} repoRoot 仓根目录。
 */
function loadRepoEnvFile(repoRoot) {
  const envPath = path.join(repoRoot, 'backend', 'ai', '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  try {
    process.loadEnvFile(envPath);
  } catch {
    // 读不了就算了 ⇒ 退回进程环境变量
  }
}

/**
 * 派活的配置（**全走环境变量** ⇒ 凭据不落盘）。
 *
 * @param {string} repoRoot 仓根目录。
 * @param {NodeJS.ProcessEnv} env 环境变量。
 */
function dispatchConfig(repoRoot, env = process.env) {
  // ⚠️ **先定路由，再派生模型与地址**（⇒ 不会出现「minimax 路由 + deepseek 模型」这种配错）。
  //
  // ⚠️ **按手里有什么 key 选路由**（⇒ 一处写、两处用）：
  //    - 显式 `DISPATCH_PROVIDER` ⇒ 听它的；
  //    - 有 `DEEPSEEK_API_KEY` ⇒ 走 **DeepSeek 官方**（与服务本体的缺省一致）；
  //    - 只有 `MINIMAX_CN_API_KEY` ⇒ 走 MiniMax（仓库里的 .env 现在的样子）；
  //    - 都没有 ⇒ 默认 DeepSeek 官方（并在派活时报「没有 key」）。
  const hasDeepseek = (env.DEEPSEEK_API_KEY ?? '').length > 0;
  const hasMinimax = (env.MINIMAX_CN_API_KEY ?? '').length > 0;
  const provider =
    env.DISPATCH_PROVIDER ??
    (!hasDeepseek && hasMinimax ? 'minimax' : 'deepseek-direct');
  // ⚠️ 路由 → (默认模型, 默认地址) 的配对表（⚠️ **配错就认证失败** ⇒ 不许各选各的）。
  const PRESET = {
    minimax: { model: 'MiniMax-M3.1-Flash', baseURL: 'https://api.minimaxi.com/v1' },
    'deepseek-direct': { model: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1' },
  };
  const preset = PRESET[provider] ?? PRESET['deepseek-direct'];
  return {
    dshBin: resolveDshBin(repoRoot, env),
    dshHome:
      env.DISPATCH_DSH_HOME ?? path.join(repoRoot, '.scratch', 'dispatch', 'dsh-home'),
    profile: env.DISPATCH_DSH_PROFILE ?? 'dispatch',
    provider,
    model: env.DISPATCH_MODEL ?? preset.model,
    baseURL: env.DISPATCH_BASE_URL ?? preset.baseURL,
    apiKeyEnv: env.DISPATCH_API_KEY_ENV ?? 'DISPATCH_API_KEY',
    /** 我们插件的目录（**仓里的源码** ⇒ 装进 dsh 的 profile）。 */
    pluginPath: path.join(repoRoot, 'backend', 'ai', 'dsh-plugin'),
    /** 开发流程的提示词（**我们自己的资产** ⇒ 保留）。 */
    promptPath: path.join(repoRoot, '.pi', 'prompts', 'dev.md'),
  };
}

/**
 * 取模型 key（**只在内存里** ⇒ 不落盘、不进日志）。
 *
 * ⚠️ 顺序：指定的环境变量（`DISPATCH_API_KEY`）⇒ `DSH_AI_API_KEY` ⇒ `DEEPSEEK_API_KEY`
 *    （后两个来自 `backend/ai/.env` ⇒ **服务与派活共用一把 key**）。
 *
 * ⚠️ **不再回退到 pi 的 `auth.json`**（issue #123 的收尾）：
 *    派活**彻底不碰 pi 的任何东西**（连凭据文件也不借）⇒ 「不要 pi」更彻底。
 *
 * @param {object} config 派活配置。
 * @param {NodeJS.ProcessEnv} env 环境变量。
 * @returns {string} key（没有 ⇒ 空串）。
 */
function resolveApiKey(config, env = process.env) {
  const direct = env[config.apiKeyEnv];
  if (direct !== undefined && direct.length > 0) {
    return direct;
  }
  // ⚠️ **按路由选对应的 key**（⇒ 配了哪个路由就用哪个 key ⇒ 不会拿错钥匙）。
  const routeKey = config.provider.startsWith('minimax')
    ? env.MINIMAX_CN_API_KEY
    : env.DEEPSEEK_API_KEY;
  if (routeKey !== undefined && routeKey.length > 0) {
    return routeKey;
  }
  const shared = env.DSH_AI_API_KEY;
  if (shared !== undefined && shared.length > 0) {
    return shared;
  }
  return '';
}

/**
 * profile 的清单（**手写** ⇒ 不用 dsh 的插件管理器绕一圈）。
 *
 * ⚠️ bundle 从 **dsh 安装**里解析 ⇒ profile 自己的 `node_modules` 不必装 bundle。
 *
 * @param {string} profileName profile 名。
 */
function profileManifest(profileName) {
  return {
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...PROFILE_BUNDLES] } },
  };
}

/**
 * profile 的补丁层（**我们的**）：插我们的插件 + 指定模型路由。
 *
 * @param {object} config 派活配置。
 */
function profilePatch(config) {
  return [
    '- insert:',
    '    - id: ai-admin',
    `      name: '${DSH_PLUGIN_PACKAGE}'`,
    // ⚠️ **把 dsh 自带的「pi-ai 支撑的 provider 适配器」关掉**
    //    （我们走自己的 provider ⇒ 那个适配器**用不到** ⇒ 关掉更干净）。
    '- id: llm-pi-ai',
    '  disabled: true',
    '- id: agent-default-model',
    '  config:',
    `    provider: ${config.provider}`,
    `    model: ${config.model}`,
    '',
  ].join('\n');
}

/**
 * 保证派活的 profile 存在且装了我们的插件（**幂等**）。
 *
 * ⚠️ **要 pnpm**（dsh 生态自己的包管理器）⇒ 没有就报错说清怎么办
 *    （**不静默降级** —— 少了插件 ⇒ 没有 provider ⇒ 派不了活）。
 *
 * @param {object} config 派活配置。
 * @param {object} [options] 选项。
 * @param {boolean} [options.dryRun] 只算不落盘（测试用）。
 */
function ensureDispatchProfile(config, options = {}) {
  const profileDir = path.join(config.dshHome, 'profiles', config.profile);
  const manifestPath = path.join(profileDir, 'package.json');
  const patchPath = path.join(profileDir, 'cordis.patch.yml');

  if (!fs.existsSync(manifestPath)) {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(profileManifest(config.profile), null, 2)}\n`,
      'utf8',
    );
  }
  // ⚠️ **补丁层每次都重写**（模型路由变了也要跟上 ⇒ 不留旧值）。
  fs.writeFileSync(patchPath, profilePatch(config), 'utf8');
  // ⚠️ **pnpm 的供应链策略要放开**（`minimumReleaseAge: 0`）
  //    ⇒ dsh 的包是 rc（刚发布不到一天）⇒ pnpm 11 默认会拦。
  fs.writeFileSync(path.join(profileDir, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 0\n', 'utf8');

  // ⚠️ **插件装进 profile**（`file:` ⇒ pnpm 把它**拷贝**进去，连带装上它的依赖）
  //    ⇒ 插件在 dsh 进程里能 import 到 @deepseek-ai/*。
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const wanted = `file:${config.pluginPath.replace(/\\/g, '/')}`;
  if (manifest.dependencies?.[DSH_PLUGIN_PACKAGE] === wanted) {
    return profileDir;
  }
  if (options.dryRun === true) {
    return profileDir;
  }
  // ⚠️ Windows 上 `.cmd` 只能经 shell 起（Node 的安全限制）⇒ 用一条命令串 + 引号。
  const added = spawnSync(
    `pnpm add "${DSH_PLUGIN_PACKAGE}@${wanted}"`,
    { cwd: profileDir, encoding: 'utf8', shell: true },
  );
  if (added.status !== 0) {
    throw new Error(
      `把 ${DSH_PLUGIN_PACKAGE} 装进 dsh profile 失败（需要 pnpm）：${
        added.stderr || added.stdout || '（没有输出）'
      }`,
    );
  }
  return profileDir;
}

/**
 * 子进程的环境变量（**凭据只走这里** ⇒ 不落盘）。
 *
 * @param {object} config 派活配置。
 * @param {object} input 系统提示词与 key。
 * @param {string} input.systemPrompt 开发流程的提示词（**纯文本**）。
 * @param {string} input.apiKey 模型 key。
 * @param {NodeJS.ProcessEnv} env 环境变量来源。
 */
function buildChildEnv(config, input, env = process.env) {
  return {
    ...env,
    DSH_HOME: config.dshHome,
    // ⚠️ **权限模式**：派活的子代理是**受信**的（在自己的工作区里干活）
    //    ⇒ 没有人在旁边点「同意」⇒ 不能停在「等人批准」上。
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_AI_PROVIDER: config.provider,
    DSH_AI_MODEL: config.model,
    DSH_AI_BASE_URL: config.baseURL,
    DSH_AI_API_KEY: input.apiKey,
    // ⚠️ **系统提示词 = 我们的开发流程**（base64 ⇒ 多行文本不进环境变量的坑）。
    DSH_AI_SYSTEM_PROMPT: Buffer.from(input.systemPrompt, 'utf8').toString('base64'),
  };
}

/**
 * 起一个派活的子会话（**后台** ⇒ 派活脚本不等它）。
 *
 * @param {object} input 入参。
 * @param {string} input.repoRoot 仓根目录。
 * @param {string} input.worktreePath 工作区（子代理在那儿干活）。
 * @param {string} input.message 任务（发给模型的那句话）。
 * @param {string} input.logPath 日志落盘位置。
 * @param {NodeJS.ProcessEnv} [input.env] 环境变量来源。
 * @returns {{pid: number, config: object}} 子进程 pid 与用到的配置。
 */
function startDispatchSession(input) {
  const env = input.env ?? process.env;
  // ⚠️ **先读 `backend/ai/.env`** ⇒ 一把 key 两处用（服务与派活）。
  //    ⚠️ **不覆盖**已存在的环境变量 ⇒ CI / 临时覆盖仍然优先。
  loadRepoEnvFile(input.repoRoot);
  const config = dispatchConfig(input.repoRoot, env);
  if (config.dshBin === '') {
    throw new Error(
      '找不到 dsh 运行时（DISPATCH_DSH_BIN / backend/ai/node_modules/@deepseek-ai/dsh）',
    );
  }
  const apiKey = resolveApiKey(config, env);
  if (apiKey === '') {
    throw new Error(
      `没有模型 key（${config.apiKeyEnv} / DEEPSEEK_API_KEY）⇒ 派不了活。` +
        `⇒ 在 backend/ai/.env 里写一行 DEEPSEEK_API_KEY=…（那个文件已被 gitignore）`,
    );
  }
  const systemPrompt = fs.readFileSync(config.promptPath, 'utf8');
  ensureDispatchProfile(config);

  const out = fs.openSync(input.logPath, 'a');
  const proc = spawn(
    process.execPath,
    [config.dshBin, '--profile', config.profile, input.message],
    {
      cwd: input.worktreePath,
      detached: true,
      stdio: ['ignore', out, out],
      env: buildChildEnv(config, { systemPrompt, apiKey }, env),
    },
  );
  proc.unref();
  fs.closeSync(out);
  return { pid: proc.pid, config };
}

module.exports = {
  DSH_PLUGIN_PACKAGE,
  PROFILE_BUNDLES,
  buildChildEnv,
  dispatchConfig,
  ensureDispatchProfile,
  loadRepoEnvFile,
  profileManifest,
  profilePatch,
  resolveApiKey,
  resolveDshBin,
  startDispatchSession,
};
