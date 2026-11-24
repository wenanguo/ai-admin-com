# dsh 的模型 UI 依赖 pi-ai —— 而我们禁了它

> 2026-11-24 · 实测记录（不是推测）· 相关：issue #123（D5=A）、#124（AI 管理面）

## 一句话

**「在 dsh 里自己加 MiniMax」这条路，被我们的 `npm overrides` 堵死了** ——
堵它的就是 D5=A（禁 pi-ai）。

## 证据

### 1. dsh 的「添加模型提供商」自定义模式 = `llm-pi-ai` 命名空间

`@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.tsx`：

```js
const piAi = state.namespaces.get('llm-pi-ai')
const customOffered = piAi !== undefined      // ← 没有 pi-ai ⇒ 自定义模式根本不提供
const customEnabled = protocols.length > 0
// 按钮：
disabled={!state.writable || state.status !== 'ready' || (!catalogEnabled && !customEnabled)}
```

⇒ **`llm-pi-ai` 挂不上 ⇒ 「添加模型提供商」按钮灰 ⇒ 加不了 MiniMax / DeepSeek / Kimi。**

### 2. 我们仓的 override 正好把它顶没了

`backend/ai/package.json`：

```json
"overrides": { "@deepseek-ai/dsh-llm-pi-ai": "$@ai-admin/dsh-stub" }
```

⇒ dsh 启动日志：

```
llm-pi-ai (@deepseek-ai/dsh-llm-pi-ai): failed to import: ERR_MODULE_NOT_FOUND
```

### 3. ⚠️ 「独立 dsh」之前是**假独立**

之前那个 `/tmp/dsh-standalone` 复用了**本仓的 `node_modules`** ⇒ 继承了上面的 override
⇒ ⇒ **它一样没有 pi-ai** ⇒ ⇒ 「独立实例也有模型选择器」是**误判**（那是 dsh 自带的
`llm-deepseek-account` 路由，不是 pi-ai）。

### 4. 真独立 ⇒ MiniMax 完整可用（本次实测）

`/tmp/dsh-solo`：独立 `package.json` + `npm i @deepseek-ai/dsh@0.2.2-rc.5`
⇒ 装到真的 `@earendil-works/pi-ai@1.6.0` ⇒ 无任何 pi-ai 报错。

配置（**凭据只写环境变量名 ⇒ 不落盘**）：

```yaml
# DSH_HOME/profiles/web/cordis.patch.yml
- id: llm-pi-ai
  config:
    providers:
      minimax:
        displayName: MiniMax
        api: openai-completions
        baseURL: https://api.minimaxi.com/v1
        apiKeyEnv: MINIMAX_CN_API_KEY
        models:
          - id: MiniMax-M3.1-Flash
            contextWindow: 131072
            maxTokens: 8192
```

实测结果：

- 模型选择器出现 `MiniMax-M3.1-Flash`；
- 发一句话 ⇒ **8 秒回复「能」**，用量 27.5K tok，缓存命中 52%。

## 由此得到的取舍（要人拍板）

**我们的自研 provider（`dsh-plugin/src/provider.js` 325 行 + 测试 136 行）
和 dsh 的 pi-ai 适配器做的是同一件事**（OpenAI 兼容 + 自定义 baseURL/key/model）⇒
⇒ 「自己实现」这一项，**在 provider 上确实成立**。

| | D5=A（现状：禁 pi-ai） | D5=B（允许 pi-ai 回来） | D5=C（仓里禁 / 独立项目带） |
|---|---|---|---|
| 我们仓依赖树干净 | ✅ | ❌ | ✅ |
| dsh 模型 UI 完整 | ❌ | ✅ | ✅（在独立项目里） |
| 换模型要改 .env + 重启 | 要 | 不要 | 不要（在独立项目里） |
| 自研 provider 可删 | — | ✅（-461 行） | —（我们仍需要自己的 provider 跑业务会话） |

## 教训

1. **「独立实例」必须有自己的 `node_modules`** ⇒ 否则 npm overrides 会「隔空」作用。
2. **dsh 的模型 UI 不是「额外的 UI」** ⇒ 它**就是** `llm-pi-ai` 命名空间 ⇒ 禁 pi-ai = 放弃模型 UI。
3. 之前关于「模型选择器是否需要 pi-ai」我给过**两个错判**（一次说需要、一次说不需要）
   ⇒ ⇒ 正确说法：**模型*列表*来自 dsh 自带的 `llm-deepseek-account`；**自定义模型提供商**才需要 pi-ai。**
