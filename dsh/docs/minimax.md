# MiniMax 配置（独立 dsh 项目）

> 这份文档回答三件事：**key 从哪来** · **路由怎么配** · **配错了长什么样**。

---

## 1. 拿 key

1. 打开 <https://platform.minimaxi.com> ⇒ 登录；
2. 进「**API Key**」⇒ 新建一个 key（形如 `sk-…`）；
3. **复制下来**（只显示一次）。

⚠️ **key 只往环境变量里放** ⇒ 仓库里搜不到密钥：

```bash
cd dsh
cp .env.example .env
# 在 .env 里写一行（.env 已被 gitignore）：
MINIMAX_CN_API_KEY=sk-你的key
```

或者不建 `.env`，直接：

```bash
export MINIMAX_CN_API_KEY=sk-你的key
```

⚠️ **已存在的环境变量优先**（`process.loadEnvFile` 的行为）⇒ 临时覆盖不用改文件。

---

## 2. 路由怎么配

MiniMax 走 **OpenAI 兼容协议** ⇒ dsh 自带的 `@deepseek-ai/dsh-llm-pi-ai` 适配器直接认：

| 配什么 | 变量 | 缺省 |
| ------ | ---- | ---- |
| 路由名 | `STANDALONE_PROVIDER` | `minimax` |
| 模型 id | `STANDALONE_MODEL` | `MiniMax-M3` |
| 根地址 | `STANDALONE_BASE_URL` | `https://api.minimaxi.com/v1` |
| **key 在哪个变量里** | `STANDALONE_API_KEY_ENV` | `MINIMAX_CN_API_KEY` |

这四项会变成 profile 补丁里的**一段**（**只写变量名 ⇒ 密钥不落盘**）：

```yaml
- id: llm-pi-ai
  config:
    providers:
      "minimax":
        displayName: "minimax"
        api: openai-completions
        baseURL: "https://api.minimaxi.com/v1"
        apiKeyEnv: "MINIMAX_CN_API_KEY"     # ← 只写变量名
        models:
          - id: "MiniMax-M3"
            contextWindow: 262144
            maxTokens: 32768
            reasoningEfforts: false
```

⚠️ **`reasoningEfforts: false` 是故意的** ⇒ MiniMax 的模型目录里带思考能力 ⇒ 不显式关掉的话，
思考预算会**挤占 `max_tokens`** ⇒ 答案被截断（**不报错，只是答不全** ⇒ 极难查）。

⚠️ **`apiKeyEnv` 指向的变量必须真的在环境里** ⇒ dsh 自带的适配器按**名字**去取 ⇒
名字写错 ⇒ 报「没有凭据」而不是「key 错了」。

---

## 3. ⚠️ **别用 `MiniMax-M3.1-Flash`**（实测坑）

本仓的派活链路踩过：**`MiniMax-M3.1-Flash` 在 dsh 的 headless 里会「只读不写」**
（三轮派活 · 每轮 40～60 分钟 · 100+ 次工具调用 · **零文件产出** ⇒ 全作废）。
换成**全量 `MiniMax-M3`** 之后，同一个任务 7 分钟就开始写代码。

⇒ **本项目的缺省模型是 `MiniMax-M3`** ⇒ 别改。

---

## 4. 配错了长什么样

| 症状 | 原因 | 怎么办 |
| ---- | ---- | ---- |
| `401` / `authentication_error` | key 不对，或用错了厂商的 key | 换 `MINIMAX_CN_API_KEY` 的值；确认是 MiniMax 的 key |
| `model not found` | 模型 id 拼错 | 用 `MiniMax-M3`（**不是** `MiniMax-M3.1-Flash`） |
| `没有凭据` / `NO_CREDENTIALS` | **变量名**对不上 | `STANDALONE_API_KEY_ENV` 指向的变量里要有值 |
| `NO_ADAPTER: no adapter registered for provider "minimax"` | profile 的补丁没生效 | 重跑 `npm run bootstrap`；看 `cordis.patch.yml` 里有没有 `llm-pi-ai` 那一段 |
| 回答被截断 / 只答一半 | 思考预算挤占了输出 | 确认 `reasoningEfforts: false`；调大 `STANDALONE_MAX_TOKENS` |
| 模型跑很久**不写文件** | 用了 Flash | 换 `MiniMax-M3` |

---

## 5. 换成别的厂商（OpenAI 兼容就行）

```bash
# DeepSeek 官方
export STANDALONE_PROVIDER=deepseek-direct
export STANDALONE_MODEL=deepseek-chat
export STANDALONE_BASE_URL=https://api.deepseek.com/v1
export DEEPSEEK_API_KEY=sk-你的key
export STANDALONE_API_KEY_ENV=DEEPSEEK_API_KEY
npm run bootstrap
```

⚠️ **改完路由要重跑 `npm run bootstrap`** ⇒ 补丁每次都重写（不留旧值）。
⚠️ **路由名不在 dsh 的目录里也能用** ⇒ 只是**没有计价信息**（cost）而已。

---

## 6. 密钥纪律（本项目的硬规矩）

1. **只走环境变量** ⇒ `.env`（已 gitignore）或 shell 导出；
2. **补丁里只写变量名**（`apiKeyEnv`）⇒ 密钥**不落盘**；
3. **只进 dsh 子进程的环境变量** ⇒ 进程内存 ⇒ 不进日志、不进镜像；
4. **仓库里搜不到密钥** ⇒ 入库的只有 `.env.example`（**空值**）。

自检：

```bash
# 仓库里不该出现真值（应该什么也不输出）
grep -rE 'sk-[A-Za-z0-9]{16,}' dsh/ --include='*' | grep -v node_modules
```
