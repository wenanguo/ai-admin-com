# dsh 独立项目（issue #183）

> **一个能自己装起来的 DeepSeek Harness（dsh）项目** —— 不依赖 AiAdmin 的业务系统。
> 新人 / 别的团队照着下面的步骤走一遍，就能跑起 dsh、连上 MiniMax、聊起来。

| | |
| --- | --- |
| **自己的依赖** | `dsh/package.json` + `dsh/package-lock.json` ⇒ **不进本仓依赖树** |
| **自己的 profile** | `$STANDALONE_HOME/profiles/standalone`（一个独立的 pnpm 工程） |
| **自己的镜像** | `dsh/Dockerfile` |
| **外部插件** | 本仓的插件**按 `file:` 引用**装进 profile（**不复制源码**） |
| **凭据** | **只走环境变量** ⇒ 仓库里搜不到密钥 |

⚠️ **它不改动本仓的任何现有服务**（`backend/ai` / 前端 / 9 个端点 **0 改动**）⇒
它只是**多了**一个能单独跑的目录。

---

## 1. 30 秒速览

```bash
cd dsh
npm ci                          # 装依赖（自己的 lock ⇒ 不进本仓依赖树）
cp .env.example .env            # 填 MiniMax 的 key（**只在你机器上**）
npm run doctor                  # 自检：还差什么会列出来
npm run bootstrap               # 建 profile + 装外部插件
npm run chat -- "用一句话回答：1+1 等于几？"
```

---

## 2. 前置条件

| 要什么 | 版本 / 从哪来 | 为什么 |
| ------ | ------------- | ------ |
| **Node** | **≥ 24.9**（`node -v`） | dsh 的 `engines` 要求 |
| **pnpm** | ≥ 11（`npm i -g pnpm@11.22.0`） | dsh 的 profile 是 **pnpm 工程** ⇒ 装插件要它 |
| **MiniMax 的 key** | <https://platform.minimaxi.com> 控制台 | 模型凭据（**只走环境变量**） |
| 磁盘 | ≈ 500 MB（node_modules + profile） | dsh 的全家桶不小 |

⚠️ **Windows 用户注意**：`pnpm` 的可执行文件是 `.cmd` ⇒ 脚本里是**经 shell** 调它的
（Node 的安全限制：不经 shell 直接 spawn `.cmd` 会失败）⇒ **不用管**，脚本已经处理了。

---

## 3. 第 1 步：装依赖

```bash
cd dsh
npm ci
```

- 依赖只有 **一个**：`@deepseek-ai/dsh`（dsh 的运行时本体 ⇒ CLI + 全家桶插件）。
- ⚠️ **版本精确写死**（`0.2.2-rc.5`，无 `^` / `~`）⇒ dsh 是 RC ⇒ 不让它悄悄换版本。
- ⚠️ **pi-ai 在这个项目自己的树里**（dsh 自带的 `@deepseek-ai/dsh-llm-pi-ai` 适配器
  建在 pi-ai 上）⇒ **本仓 `backend/ai` 的依赖树不受影响**。

## 4. 第 2 步：配凭据（MiniMax）

```bash
cd dsh
cp .env.example .env
# 编辑 .env ⇒ 填一行：
#   MINIMAX_CN_API_KEY=你的key
```

- **`.env` 已被 gitignore** ⇒ 真值只在你机器上 ⇒ **仓库里搜不到密钥**。
- 也可以不建 `.env`，直接 `export MINIMAX_CN_API_KEY=你的key`（**已存在的环境变量优先**）。
- ⚠️ **不许在 `.env` 里写 `DSH_` 开头的键** ⇒ dsh 的 app-boot 拒收 `.env` 里的 `DSH_*`
  （`BOOTSTRAP_PREFIXES`）⇒ 照着写会让 dsh **拒绝启动**。
  ⇒ 本项目的用户可配变量一律叫 `STANDALONE_*`。

详见 [`docs/minimax.md`](docs/minimax.md)（**MiniMax 配置与排错**）。

## 5. 第 3 步：自检

```bash
npm run doctor
```

逐项检查：Node 版本 · 依赖装没装 · pnpm 在不在 · **模型凭据有没有**（**只说有没有，不打印**）·
profile 好了没 · 外部插件装没装。**全绿**才往下走。

## 6. 第 4 步：引导 profile（装外部插件）

```bash
npm run bootstrap
```

它做三件事：

1. **建 profile** —— `$STANDALONE_HOME/profiles/standalone`（一个**独立的 pnpm 工程**）
   + `pnpm-workspace.yaml`（放开 pnpm 的供应链策略：dsh 的包是 rc ⇒ pnpm 11 默认会拦）；
2. **写自己的补丁**（`cordis.patch.yml`）—— 插插件 + 声明 MiniMax 路由 + 指定默认模型；
3. **装外部插件** —— `pnpm add "@ai-admin/dsh-plugin@file:<源码目录>"`
   ⇒ **按引用装**（`file:`）⇒ **不复制源码** ⇒ 插件改了，重跑一次就更新。

⚠️ **幂等**：插件的**内容指纹**没变 ⇒ 跳过重装（装插件要联网、要时间）。

## 7. 第 5 步：跑对话

```bash
npm run chat -- "用一句话回答：1+1 等于几？"
```

- 走 **dsh 的 headless 模式**（答一个任务、打印结果、退出）。
- 凭据**只进子进程的环境变量**（进程内存）⇒ **不落盘**。

---

## 8. 外部插件：装的是什么、怎么换

**装的是本仓的 dsh 插件**（`backend/ai/dsh-plugin`）—— 它是 AiAdmin 那一侧的东西：
系统提示词、命令桥（回调 AiAdmin 执行命令）、MCP 挂载与**闸门**。

| 想干嘛 | 怎么做 |
| ------ | ------ |
| **装**（默认） | `npm run bootstrap` ⇒ 插件按 `file:` 引用装进 profile |
| **不装**（纯 dsh，不带 AiAdmin） | `STANDALONE_PLUGIN=off npm run bootstrap` |
| **换成别的插件** | `STANDALONE_PLUGIN_PATH=/abs/path/to/your-plugin npm run bootstrap` |
| **让插件真的能干活** | 额外给 `AI_DSH_BRIDGE_URL` / `AI_DSH_BRIDGE_SECRET`（⇒ 见 §9） |

⚠️ **不装插件也能跑**：dsh 自带的能力（文件读写、bash、技能……）照样在；
只是**没有** AiAdmin 的命令与提示词。

## 9. 让插件驱动 AiAdmin（可选）

插件的「命令桥」是**回调 AiAdmin 的 AI 服务**执行命令 ⇒ 要给它地址与密钥：

```bash
export AI_DSH_BRIDGE_URL=http://127.0.0.1:3100/internal/dsh/commands
export AI_DSH_BRIDGE_SECRET=与 AI 服务一致的进程内密钥
export AI_DSH_SYSTEM_PROMPT=$(base64 -w0 prompt.md)   # 可选：进模型上下文
```

⚠️ **闸门照旧**：「新增放行、修改要点头」的口径在 **AiAdmin 那边**算 ⇒
本项目**不复制**那份口径 ⇒ 插件只是**问**，回答由 AiAdmin 给。

## 10. 自己的 profile 长什么样

```
$STANDALONE_HOME/profiles/standalone/
├── package.json            # pnpm 工程（bundles: dsh-base + dsh-headless）
├── pnpm-workspace.yaml     # minimumReleaseAge: 0（rc 包 ⇒ 放开供应链策略）
├── cordis.patch.yml        # ★ 我们自己的补丁（下面全文）
├── .ai-admin-plugin.json   # 插件的安装状态（内容指纹 ⇒ 变了就重装）
└── node_modules/           # 插件的**拷贝**（pnpm file: 装进来的）
```

`cordis.patch.yml`（**注意：里面只有变量名，没有密钥**）：

```yaml
- insert:
    - id: ai-admin
      name: '@ai-admin/dsh-plugin'
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false
    customSkillDirs: !!js "process.env.AI_DSH_SKILL_DIRS ? JSON.parse(Buffer.from(process.env.AI_DSH_SKILL_DIRS, 'base64').toString('utf8')) : []"
- id: llm-pi-ai
  config:
    providers:
      "minimax":
        displayName: "minimax"
        api: openai-completions
        baseURL: "https://api.minimaxi.com/v1"
        apiKeyEnv: "MINIMAX_CN_API_KEY"     # ← ★ 只写变量名 ⇒ 密钥不落盘
        models:
          - id: "MiniMax-M3"
            contextWindow: 262144
            maxTokens: 32768
            reasoningEfforts: false
- id: agent-default-model
  config:
    provider: "minimax"
    model: "MiniMax-M3"
```

⚠️ **三处要点**：

1. **`apiKeyEnv`** ⇒ dsh 自带的适配器按**变量名**去环境变量里取 key ⇒ 密钥只在进程内存里；
2. **`includeDefaultRoots: false`** ⇒ **不扫** dsh 的默认技能根
   （默认根会把「仓库自己的开发技能」与「开发者私人技能」混进会话）⇒ 只认 `STANDALONE_SKILL_DIRS`；
3. **provider 归位给 dsh 自带的 `llm-pi-ai`** ⇒ 本项目**不自研 provider**
   （与本仓 `backend/ai` 同一口径 · issue #168 的 D5=B）。

## 11. 镜像

```bash
# 构建（**上下文是仓根** ⇒ 插件源码要一起进去）
docker build -f dsh/Dockerfile -t dsh-standalone .

# 跑（**凭据只从环境变量给** ⇒ 不进镜像）
docker run --rm -e MINIMAX_CN_API_KEY=你的key dsh-standalone "用一句话回答：1+1 等于几？"
```

- **profile 在构建阶段预热**（插件装好了）⇒ **运行时不需要联网**。
- 镜像里**只有变量名**，没有密钥。

## 12. 常见问题

| 症状 | 原因 | 怎么办 |
| ---- | ---- | ---- |
| `dsh: …/.env sets "DSH_xxx", which only the launching environment may set` | `.env` 里写了 `DSH_*` | 改成 `STANDALONE_*`（或删掉） |
| `NO_ADAPTER: no adapter registered for provider "minimax"` | profile 的补丁没生效 | 重跑 `npm run bootstrap`；确认 `cordis.patch.yml` 里有 `llm-pi-ai` 那一段 |
| `找不到 dsh 运行时` | 依赖没装 | `cd dsh && npm ci` |
| `把插件装进 profile 失败（需要 pnpm）` | 没装 pnpm / 没联网 | `npm i -g pnpm@11.22.0` |
| 模型回得很慢或**只读不写** | 用了 `MiniMax-M3.1-Flash` | 换成 **`MiniMax-M3`**（见 `docs/minimax.md`） |
| 改了插件没生效 | profile 里是**拷贝** | 重跑 `npm run bootstrap`（内容指纹变了 ⇒ 重装） |

## 13. 目录结构

```
dsh/
├── package.json          # 自己的依赖（精确版本）—— 不进本仓依赖树
├── package-lock.json     # 自己的 lock
├── Dockerfile            # 自己的镜像
├── .env.example          # 凭据模板（**没有真值**）
├── docs/minimax.md       # MiniMax 配置与排错
└── scripts/
    ├── bootstrap.mjs     # 建 profile + 装外部插件
    ├── chat.mjs          # 真起 dsh 跑一轮对话
    ├── doctor.mjs        # 自检（还差什么）
    └── lib/
        ├── config.mjs    # 配置（全走环境变量）
        ├── profile.mjs   # profile 引导 + 插件指纹
        └── runtime.mjs   # 起 dsh 子进程（凭据只走环境变量）
```

## 14. 与本仓的关系

- ❌ **不动** `backend/ai`（服务）· 前端 · 9 个端点 · 本仓的 provider 归位结论（issue #168 的 D5=B）。
- ✅ **多了** `dsh/` 一个独立目录 ⇒ 自己的依赖树、自己的 profile、自己的镜像。
- ✅ 本仓的插件**按引用装**（`file:`）⇒ **只有一份源码**（`backend/ai/dsh-plugin`）。
