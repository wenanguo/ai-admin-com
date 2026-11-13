# 端到端验收脚本

> 这些脚本**会真的改 AiAdmin 里的数据** ⇒ 只在测试环境跑。

| 脚本 | 干什么 |
| ---- | ------ |
| `login.cjs` | 登录取 access token（验证码答案从 Redis 读；本地开发环境才有）⇒ 写到 `.scratch/token.txt` |
| `ai-gate.cjs` | 浏览器跑一遍「AI 改任务 → 挂起等人点头 → 同意 → 任务真被改」 |
| `web-container.static.cjs` | **静态断言**前端镜像的配置（Dockerfile / nginx.conf / .dockerignore）⇒ **不需要 docker** |
| `web-container.cjs` | **真起容器**验收前端镜像（构建 → `nginx -t` → 首页 → SPA fallback → 缓存头 → `/healthz`）⇒ 需要 docker |

## 用法

```bash
# 1) 先起两个服务
cd frontend && npm run dev        # 8000
cd backend/ai && npm run dev       # 3100

# 2) 取 token
node scripts/e2e/login.cjs

# 3) 跑验收
node scripts/e2e/ai-gate.cjs
NEW_TITLE=随便一个新标题 node scripts/e2e/ai-gate.cjs   # 重复跑要换标题，否则模型说「已经是这个标题了」
```

## 前端镜像验收（issue #38）

```bash
# 静态断言（不需要 docker，任何机器都能跑）
node scripts/e2e/web-container.static.cjs
# 或
npm run e2e:web:static

# 真起容器（需要 docker；没 docker ⇒ 打印 SKIP 并退出 0）
node scripts/e2e/web-container.cjs
# 或
npm run e2e:web
```

CI（`.github/workflows/docker-web.yml`）在 PR 上跑这两条 —— runner 自带 docker ⇒ 容器验收是真跑的。

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `IMAGE` | `ai-admin-web:local` | 容器验收用的镜像名 |
| `PORT` | `18080` | 容器验收占用的宿主机端口 |
| `SKIP_BUILD` | — | `=1` 时跳过构建（用已有镜像） |

## 环境变量

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `FRONTEND_URL` | `http://localhost:8000` | 前端地址 |
| `TASK_ID` | `117` | 用来改的那个任务 id |
| `NEW_TITLE` | 自动生成 | 改成的标题 |
| `USER_TOKEN` / `TOKEN_FILE` | `.scratch/token.txt` | token 来源 |
| `AIADMIN_BASE_URL` | `https://www.pmdict.cn/api/v1` | AiAdmin 后端 |
| `REDIS_HOST` / `REDIS_PASSWORD` … | 见脚本 | 只用于读验证码答案 |

## 为什么它们在仓里

写在 `.scratch/` 里的脚本会被 gitignore ⇒ 不能复跑、不能进 CI、同事看不到。
⇒ 这两个是**验收的证据**，要能重跑。
