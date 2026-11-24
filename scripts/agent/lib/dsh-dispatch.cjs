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
 * | `DISPATCH_MODEL` | `MiniMax-M3` | 模型 id（⚠️ **别用 M3.1-Flash** ⇒ 实测它只读不写，见下） |
 * | `DISPATCH_BASE_URL` | `https://api.minimaxi.com/v1` | OpenAI 兼容的根地址 |
 * | `DISPATCH_API_KEY` | —— | 模型 key（**只在环境变量里**） |
 * | `DISPATCH_API_KEY_ENV` | `DISPATCH_API_KEY` | key 放在哪个环境变量里 |
 *
 * ⚠️ **过渡期**：key 还没挪走时，允许从 pi 的 `auth.json` 里借**凭据**
 *    （**只借凭据，不依赖它的代码** ⇒ 依赖树里没有 pi）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

/** 我们插件的包名（**装进 dsh profile 的那个名字**）。 */
const DSH_PLUGIN_PACKAGE = '@ai-admin/dsh-plugin';

/**
 * 插件状态的**文件名**（放在 profile 目录里 ⇒ 跟着 profile 一起持久化）。
 *
 * ⚠️ **与服务侧同一份**（`backend/ai/src/core/adapter/dsh/profile.ts` 的同名常量）
 *    ⇒ 两边看到的是同一个 profile ⇒ 状态文件互相认。
 */
const PLUGIN_STATE_FILE = '.ai-admin-plugin.json';

/** 算指纹时**不看**的目录（依赖 / 版本库 ⇒ 与「插件源码变没变」无关）。 */
const FINGERPRINT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.pnpm-store',
  '.turbo',
  '.cache',
]);

/** profile 里要用的 bundle（**dsh 自带** ⇒ 从 dsh 安装里解析）。 */
const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'];

/**
 * 读一个正整数环境变量（**读不懂就用缺省** ⇒ 不因为配置写错而崩溃）。
 *
 * @param {NodeJS.ProcessEnv} env 环境变量。
 * @param {string} name 变量名。
 * @param {number} fallback 缺省值。
 * @returns {number} 数值。
 */
function numberEnv(env, name, fallback) {
  const raw = env[name];
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * **拼系统提示词** = 我们的开发流程（`.pi/prompts/dev.md`）+ **工作区说明**。
 *
 * ## 为什么必须拼「工作区说明」
 *
 * 实测（第一次 dsh 派活）：子代理**不知道自己在哪个目录** ⇒ 它的工具调用用了
 * **主 checkout 的绝对路径**（`D:\project\ai-admin-com\...`）⇒
 * 一旦它写文件，**会写进别人的 checkout**（而主 checkout 是 PM 自己在用的 ⇒ 会互相打架）。
 *
 * ⇒ 明确告诉它：**只在这个工作区里干活**（含分支名 ⇒ 它知道该提哪个 PR）。
 *
 * @param {object} config 派活配置。
 * @param {string} worktreePath 工作区路径。
 * @param {string} [branch] 分支名。
 * @returns {string} 系统提示词。
 */
function buildSystemPrompt(config, worktreePath, branch) {
  const base = fs.readFileSync(config.promptPath, 'utf8');
  return (
    `${base}\n\n` +
    `---\n\n` +
    `## 你的工作区（**只在这里干活**）\n\n` +
    `- 工作区（cwd）：\`${worktreePath}\`\n` +
    (branch ? `- 分支：\`${branch}\`（⇒ PR 就提到这个分支）\n` : '') +
    `- ⚠️ **所有**文件读写、命令、git 操作都必须在上面这个目录里。\n` +
    `- ⚠️ **不要碰主 checkout**（\`${config.repoRoot ?? ''}\` —— 那是 PM 自己在用的那份）\n` +
    `  ⇒ 写进去会互相打架（分支、文件、提交都会撞）。\n` +
    `- ⚠️ 相对路径就是相对**工作区** ⇒ 直接用 \`backend/ai/...\` 这种写法就行。\n`
  );
}

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
    // ⚠️ **实测（2026-11-20）**：`MiniMax-M3.1-Flash` 在 dsh 的 headless 里会**只读不写**
    //    （三轮派活 · 每轮 40~60 分钟 · 100+ 次工具调用 · **零文件** ⇒ 全作废）。
    //    换成 `MiniMax-M3` ⇒ 同一个任务 7 分钟就开始写代码、40 分钟交出 3 个提交 + PR。
    //    ⇒ 派活的缺省模型必须是**全量 M3**，不是 Flash。
    minimax: { model: 'MiniMax-M3', baseURL: 'https://api.minimaxi.com/v1' },
    'deepseek-direct': { model: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1' },
  };
  const preset = PRESET[provider] ?? PRESET['deepseek-direct'];
  return {
    repoRoot,
    dshBin: resolveDshBin(repoRoot, env),
    dshHome:
      env.DISPATCH_DSH_HOME ?? path.join(repoRoot, '.scratch', 'dispatch', 'dsh-home'),
    profile: env.DISPATCH_DSH_PROFILE ?? 'dispatch',
    provider,
    model: env.DISPATCH_MODEL ?? preset.model,
    baseURL: env.DISPATCH_BASE_URL ?? preset.baseURL,
    apiKeyEnv: env.DISPATCH_API_KEY_ENV ?? 'DISPATCH_API_KEY',
    // ⚠️ **输出上限**（dsh 缺省 8192 ⇒ 长消息被截断 ⇒ 整个会话作废 ⇒ 派活给足）。
    maxTokens: numberEnv(env, 'DISPATCH_MAX_TOKENS', 32768),
    // ⚠️ **上下文窗口**（探索型任务读很多文件 ⇒ 给足）。
    contextWindow: numberEnv(env, 'DISPATCH_CONTEXT_WINDOW', 262144),
    /** 我们插件的目录（**仓里的源码** ⇒ 装进 dsh 的 profile）。 */
    pluginPath: path.join(repoRoot, 'backend', 'ai', 'dsh-plugin'),
    /** 开发流程的提示词（**我们自己的资产** ⇒ 保留）。 */
    promptPath: path.join(repoRoot, '.pi', 'prompts', 'dev.md'),
  };
}

/**
 * 取模型 key（**只在内存里** ⇒ 不落盘、不进日志）。
 *
 * ⚠️ 顺序：指定的环境变量（`DISPATCH_API_KEY`）⇒ `AI_DSH_API_KEY` ⇒ `DEEPSEEK_API_KEY`
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
  const shared = env.AI_DSH_API_KEY;
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
 * profile 的补丁层（**我们的**）：插我们的插件 + **声明模型路由**。
 *
 * ⚠️ **provider 归位给 dsh 自带的适配器**（issue #168 · D5=B）：
 *    路由写在 `llm-pi-ai` 那一段的 `providers` 里 ⇒ dsh 自带的
 *    `@deepseek-ai/dsh-llm-pi-ai` 认它 ⇒ **我们不再自研 provider**。
 * ⚠️ **凭据只写环境变量名**（`apiKeyEnv`）⇒ **密钥不落盘**（只在子进程的环境变量里）。
 *
 * @param {object} config 派活配置。
 */
function profilePatch(config) {
  return [
    '- insert:',
    '    - id: ai-admin',
    `      name: '${DSH_PLUGIN_PACKAGE}'`,
    // ⚠️ **模型路由**（dsh 自带的 pi-ai 适配器 ⇒ 路由名 = provider 名）。
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    `      ${yamlScalar(config.provider)}:`,
    `        displayName: ${yamlScalar(config.provider)}`,
    '        api: openai-completions',
    `        baseURL: ${yamlScalar(config.baseURL)}`,
    `        apiKeyEnv: ${yamlScalar(config.apiKeyEnv)}`,
    '        models:',
    `          - id: ${yamlScalar(config.model)}`,
    `            contextWindow: ${config.contextWindow}`,
    `            maxTokens: ${config.maxTokens}`,
    '- id: agent-default-model',
    '  config:',
    `    provider: ${config.provider}`,
    `    model: ${config.model}`,
    '',
  ].join('\n');
}

/**
 * YAML 的**双引号标量**（⇒ 值里的 `:` / `#` / 引号都不会被当成语法）。
 *
 * @param {string} value 字符串。
 * @returns YAML 标量。
 */
function yamlScalar(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 插件的**内容指纹**（sha256，十六进制）。
 *
 * ## 算什么
 *
 * 插件目录里**每个文件**的（相对路径 + 内容哈希）⇒ 排序后拼起来再哈希。
 *
 * ## ⚠️ **必须与服务侧算出同一个值**
 *
 * 服务侧那份在 `backend/ai/src/core/adapter/dsh/profile.ts`（同名函数）
 * ⇒ 两边的测试都**钉住同一个 fixture 值** ⇒ 算法漂了就有人看见。
 *
 * @param {string} pluginPath 插件目录。
 * @returns {string} 指纹（十六进制）。
 */
function pluginFingerprint(pluginPath) {
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`找不到我们的插件目录：${pluginPath}`);
  }
  const hash = crypto.createHash('sha256');
  for (const file of pluginFiles(pluginPath)) {
    hash.update(file.relativePath);
    hash.update('\n');
    hash.update(
      crypto.createHash('sha256').update(fs.readFileSync(file.absolutePath)).digest('hex'),
    );
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * 插件目录里的文件（**按相对路径排序** ⇒ 指纹与遍历顺序无关）。
 *
 * @param {string} pluginPath 插件目录。
 * @returns {{relativePath: string, absolutePath: string}[]} 文件清单。
 */
function pluginFiles(pluginPath) {
  const out = [];
  const walk = (dir) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (FINGERPRINT_IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      out.push({
        relativePath: path.relative(pluginPath, absolutePath).split(path.sep).join('/'),
        absolutePath,
      });
    }
  };
  walk(pluginPath);
  out.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  return out;
}

/**
 * 读插件的安装状态（**没有 / 坏了 ⇒ undefined** ⇒ 视为「要重装」）。
 *
 * @param {string} profileDir profile 目录。
 * @returns {{fingerprint: string, spec: string, installedAt: string}|undefined} 状态。
 */
function readPluginState(profileDir) {
  const file = path.join(profileDir, PLUGIN_STATE_FILE);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed?.fingerprint !== 'string' || typeof parsed?.spec !== 'string') {
      return undefined;
    }
    return {
      fingerprint: parsed.fingerprint,
      spec: parsed.spec,
      installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : '',
    };
  } catch {
    return undefined;
  }
}

/**
 * 写插件的安装状态（**装完才写** ⇒ 写坏了就当没装过 ⇒ 下次重装）。
 *
 * @param {string} profileDir profile 目录。
 * @param {{fingerprint: string, spec: string, installedAt: string}} state 状态。
 */
function writePluginState(profileDir, state) {
  fs.writeFileSync(
    path.join(profileDir, PLUGIN_STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

/**
 * 保证派活的 profile 存在且装了我们的插件（**幂等 + 插件一改就重装**）。
 *
 * ⚠️ **要 pnpm**（dsh 生态自己的包管理器）⇒ 没有就报错说清怎么办
 *    （**不静默降级** —— 少了插件 ⇒ 没有 provider ⇒ 派不了活）。
 *
 * ⚠️ **判据 = 内容指纹**（issue #158）：`pnpm add file:` 是把插件**拷贝**进 profile 的
 *    ⇒ 路径永远不变 ⇒ **拷贝永远不刷新** ⇒ 改了插件等于没改
 *    （实测：把 `DSH_AI_*` 改名成 `AI_DSH_*` ⇒ dsh 报 `NO_ADAPTER` ⇒ 派活瘫）。
 *    ⇒ 现在按**内容**判：指纹变了就重装；没变就**跳过**（pnpm 装东西要联网、要时间）。
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
  const fingerprint = pluginFingerprint(config.pluginPath);
  const state = readPluginState(profileDir);
  const installedCopy = path.join(
    profileDir,
    'node_modules',
    ...DSH_PLUGIN_PACKAGE.split('/'),
  );
  const upToDate =
    state !== undefined &&
    state.fingerprint === fingerprint &&
    state.spec === wanted &&
    manifest.dependencies?.[DSH_PLUGIN_PACKAGE] !== undefined &&
    fs.existsSync(installedCopy);
  if (upToDate) {
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
  writePluginState(profileDir, {
    fingerprint,
    spec: wanted,
    installedAt: new Date().toISOString(),
  });
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
    // ⚠️ **key 落在「它自己的名字」那个变量里**（issue #168）：
    //    dsh 自带的 pi-ai 适配器按补丁里的 `apiKeyEnv` **去环境变量里取 key**
    //    ⇒ 子进程里必须有一个**同名**的变量 ⇒ 密钥仍然**只在内存里**（不落盘）。
    [config.apiKeyEnv]: input.apiKey,
    AI_DSH_PROVIDER: config.provider,
    AI_DSH_MODEL: config.model,
    AI_DSH_BASE_URL: config.baseURL,
    // ⚠️ **输出上限**（issue #123 收尾实测出来的坑）：
    //    dsh 的缺省是 **8192** ⇒ 一条长任务消息正好被截断
    //    （实测：#124 的子会话探索到第 67 步，最后那条消息被 8192 截掉 ⇒ **整个会话作废**）。
    //    ⇒ 派活给到 32768（长任务要有地方写）。
    AI_DSH_MAX_TOKENS: String(config.maxTokens),
    // ⚠️ **上下文窗口**（探索型任务会读很多文件 ⇒ 给足）。
    AI_DSH_CONTEXT_WINDOW: String(config.contextWindow),
    // ⚠️ **系统提示词 = 我们的开发流程**（base64 ⇒ 多行文本不进环境变量的坑）。
    AI_DSH_SYSTEM_PROMPT: Buffer.from(input.systemPrompt, 'utf8').toString('base64'),
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
  const systemPrompt = buildSystemPrompt(config, input.worktreePath, input.branch);
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
  PLUGIN_STATE_FILE,
  PROFILE_BUNDLES,
  buildChildEnv,
  buildSystemPrompt,
  dispatchConfig,
  ensureDispatchProfile,
  loadRepoEnvFile,
  pluginFingerprint,
  profileManifest,
  profilePatch,
  resolveApiKey,
  resolveDshBin,
  startDispatchSession,
};
