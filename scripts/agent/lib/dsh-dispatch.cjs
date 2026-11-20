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
const os = require('node:os');
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
 * 派活的配置（**全走环境变量** ⇒ 凭据不落盘）。
 *
 * @param {string} repoRoot 仓根目录。
 * @param {NodeJS.ProcessEnv} env 环境变量。
 */
function dispatchConfig(repoRoot, env = process.env) {
  return {
    dshBin: resolveDshBin(repoRoot, env),
    dshHome:
      env.DISPATCH_DSH_HOME ?? path.join(repoRoot, '.scratch', 'dispatch', 'dsh-home'),
    profile: env.DISPATCH_DSH_PROFILE ?? 'dispatch',
    provider: env.DISPATCH_PROVIDER ?? 'minimax',
    model: env.DISPATCH_MODEL ?? 'MiniMax-M3.1-Flash',
    baseURL: env.DISPATCH_BASE_URL ?? 'https://api.minimaxi.com/v1',
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
 * ⚠️ 顺序：指定的环境变量 ⇒ `DSH_AI_API_KEY` ⇒ **过渡期**：pi 的 `auth.json`。
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
  const shared = env.DSH_AI_API_KEY;
  if (shared !== undefined && shared.length > 0) {
    return shared;
  }
  // ⚠️ **过渡期**：凭据还放在 pi 的 auth.json 里 ⇒ 只借它的**凭据**
  //    （**不依赖它的代码** ⇒ 依赖树里没有 pi ⇒ D5=A 仍然成立）。
  const authPath = path.join(
    env.USERPROFILE || env.HOME || os.homedir(),
    '.pi',
    'agent',
    'auth.json',
  );
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const key = auth[config.provider]?.key ?? auth['minimax-cn']?.key;
    return typeof key === 'string' ? key : '';
  } catch {
    return '';
  }
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
  const config = dispatchConfig(input.repoRoot, env);
  if (config.dshBin === '') {
    throw new Error(
      '找不到 dsh 运行时（DISPATCH_DSH_BIN / backend/ai/node_modules/@deepseek-ai/dsh）',
    );
  }
  const apiKey = resolveApiKey(config, env);
  if (apiKey === '') {
    throw new Error(`没有模型 key（${config.apiKeyEnv}）⇒ 派不了活`);
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
  profileManifest,
  profilePatch,
  resolveApiKey,
  resolveDshBin,
  startDispatchSession,
};
