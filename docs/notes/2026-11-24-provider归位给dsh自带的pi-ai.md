# provider 归位给 dsh 自带的 pi-ai（2026-11-24）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue #168 · PR #172
- **一句话**：**删掉我们自研的模型适配器**（325 行）⇒ provider 改用 **dsh 自带的
  `@deepseek-ai/dsh-llm-pi-ai`** ⇒ 路由由**我们生成一段 profile 补丁**喂给它
  ⇒ **凭据只写环境变量名**（密钥不落盘）⇒ pi-ai 作为**传递依赖**回到依赖树。

## 状态

**已完成**（PR #172，CI 绿后合并）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `bd39d66` | 删 `dsh-plugin/src/provider.js` + 测试 + `stubs/dsh-llm-pi-ai/`；去 `overrides`；去 `llm-pi-ai: disabled`；新增 `profile.ts` 的 `buildPiAiProviderPatch` / `writePiAiProviderPatch`；runner 按 `apiKeyEnv` 传 key；守卫第三档改成「不许自研 provider」；派活侧 `profilePatch` 改成声明路由 |

**下一步**：无（#168 的范围做完了）。**#169 依赖本条**（它要在这套路由机制上继续做）。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **provider 归位给 dsh 自带的 `dsh-llm-pi-ai`**（D5=A → **D5=B**） | 人拍板：「保持 ai 部分的干净，只有 DSH 代码就行」⇒ dsh 自带的适配器做的就是同一件事（325 行重复实现）⇒ **重复实现消失** | 继续维护两套 provider ⇒ dsh 升级时我们要改两处 |
| **路由用「生成一段 profile 补丁」**（`- id: llm-pi-ai / config.providers.<路由名>`） | dsh 的 patch 语义是**按 id 覆盖 config**（`cordis-plugin-include` 的 `applyPatches`）⇒ 我们能**不改 dsh**就把路由喂给它 | 只能改 dsh 源码 ⇒ 升级 dsh 时必炸 |
| **补丁里只写 `apiKeyEnv`（变量名）**，key 落在**同名**的环境变量里 | dsh 自带的适配器按 `apiKeyEnv` **去环境变量里取**（`credentials` → `launchEnvironmentOf(ctx).get(ref)` ⇒ 落到进程环境）⇒ **密钥不落盘**这条老规矩保住了 | key 落盘 ⇒ 违反「凭据不落盘」⇒ 安全事故 |
| **key 落在 `config.apiKeyEnv` 那个变量里**（删掉 `AI_DSH_API_KEY`） | 「凭据只进**一个**变量」的口径不变，只是**那个变量有了自己的名字** ⇒ 派活侧与服务侧同一套 | 留在 `AI_DSH_API_KEY` ⇒ 两处 key（一个是没人认的）⇒ 违反「只进一个变量」 |
| **路由名用 `minimax`**（= pi-ai 目录里**有的** provider 名） | 与 dsh 的「添加模型提供商」里看到的名字一致 ⇒ 模型选择器里显示 `MiniMax-M3.1-Flash`（验收口径） | 用随手起的名字 ⇒ 选择器里显示怪名字 ⇒ PM 验收时以为没生效 |
| **守卫第三档：从「不许用 pi-ai」改成「不许自研 provider」** | D5=B 之后 pi-ai **必须**在树里 ⇒ 原来的守卫会**天天报错** ⇒ 守的东西换掉：**「`dsh-plugin/src/provider.js` 不得复活」**（+ 源码里不许出现 `extends LlmAdapter` / `registerAdapter(`） | 守卫名存实亡 ⇒ 下次有人又写一套 provider |
| **第四档 pi 禁令收窄为「我们的代码不许**直接**依赖 pi」** | pi-ai 是 dsh 自带适配器的**传递依赖** ⇒ 「树里不许有 pi」不成立 ⇒ 但「我们自己 import pi」仍然要禁 | 要么天天误报，要么把真禁令也放掉 |
| **服务侧与派活侧各留一份「生成路由」的实现**（.ts / .cjs） | 本仓的派活脚本是**独立的 .cjs**（不进 backend/ai 的 TS 构建）⇒ 短期两份；将来可让派活侧读服务侧产物 | 两份漂移 ⇒ 派活能跑、服务不能跑（反之亦然）⇒ **#169 收口** |

## 怎么验

```bash
# ① 类型 + 单测
cd backend/ai && npm run typecheck && npm test

# ② 边界守卫（第三档/第四档的新口径）
node scripts/check-dsh-boundary.cjs
node scripts/e2e/dsh-boundary.static.cjs      # 含新负例：自研 provider 复活 ⇒ 必须被拦
node scripts/e2e/dispatch-dsh.static.cjs

# ③ 派活链路单测
node --test "scripts/agent/*.test.cjs"

# ④ 端到端（真 dsh 子进程 + 假模型服务 ⇒ 不花钱、不外网）
#    路由 minimax / 模型 MiniMax-M3.1-Flash / key 的变量名 MINIMAX_CN_API_KEY
node scripts/e2e/dsh-runner.cjs
node scripts/e2e/dsh-skills-mcp-plugins.runtime.cjs
```

## 坑与提醒

- ⚠️ **`npm install` 会把 pi-ai 装成嵌套的**（`node_modules/@deepseek-ai/dsh-base/node_modules/@deepseek-ai/dsh-llm-pi-ai`）⇒ 不是 bug（npm 的去重决定）⇒ 但**别以为没装上**。
- ⚠️ **旧的空壳是个坏 junction**（`node_modules/@deepseek-ai/dsh-llm-pi-ai` → `dsh-base/stubs/dsh-llm-pi-ai`，目标已删）⇒ 撤掉 `overrides` 后**要把它删掉**再 `npm install`，否则 lock 里会留一条 `"extraneous": true`。
- ⚠️ **patch 是「按 id 覆盖 config」**（不是深合并）⇒ 我们那段 `llm-pi-ai` 的 config 是**整块替换** ⇒ 补丁里要写全（`providers` 整个）。
- ⚠️ **补丁里别写 `name`**：写了且与 dsh-base 那行不一致 ⇒ 整段补丁**被跳过**（只留一行警告）⇒ 路由静默不生效。
- ⚠️ **路由名命中 pi-ai 的目录**（如 `minimax`）时，目录里的模型会**补全**我们没写的字段（`name` / `cost` / `reasoning`）⇒ 但 `api` / `baseURL` / `contextWindow` / `maxTokens` 以**我们写的**为准（`resolveRouteModels`）。
- ⚠️ **`AI_DSH_API_KEY` 这个名字彻底没人认了**（旧文档里还有）⇒ 将来清文档时一起改。
- ⚠️ `scripts/agent/merge-pr.test.cjs` 的 `branchCheckedOutInWorktree` 在 **Windows 本地**必失败（`git worktree remove` 收到 8.3 短路径）⇒ **改动前就失败**（`main` 上复现过）⇒ 与本条无关；CI（ubuntu）过。
