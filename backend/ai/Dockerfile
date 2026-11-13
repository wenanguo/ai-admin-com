# syntax=docker/dockerfile:1
#
# AiAdmin AI 服务镜像（多阶段）
#
#   构建上下文 = **仓根**：
#     docker build -f backend/ai/Dockerfile -t ai-admin-ai .
#
#   阶段 1（builder）：node 22 ⇒ npm ci ⇒ tsc（ESM）⇒ prisma generate
#   阶段 2（runtime）：node 22 ⇒ 只有生产依赖 + dist/ + 技能 + prisma 客户端
#
# ⚠️ **构建阶段不连数据库、不读 .env、不带任何凭据** ⇒ 构建机上不需要私有信息。
# ⚠️ **不用 alpine**：prisma 的查询引擎在 musl 上要另配 openssl（且要挑对引擎变体）
#    ⇒ 用 debian slim（与前端镜像的 node 阶段一致）。
# ============================================================

ARG NODE_VERSION=22

# ─────────────────────────── 构建阶段 ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /app

ENV HUSKY=0 \
    CI=true

# 钉住 npm 版本（与仓库 CI / 前端镜像一致：npm 10.9.9）
# ⚠️ node:22 现在默认带 npm 11 ⇒ 它的「package.json 与 package-lock.json 必须同步」
#    检查比 npm 10 严 ⇒ 现有的 lock（npm 10 生成的）可能被判不同步 ⇒ npm ci 失败。
RUN node -v && npm install -g npm@10.9.9 && npm -v

# ① 依赖层：先只拷清单 ⇒ 改源码不会让 npm ci 这一层失效
COPY backend/ai/package.json backend/ai/package-lock.json ./

# ⚠️ --ignore-scripts：此刻源码还没拷进来，`prisma generate` 也还没有 schema
#    ⇒ 让 postinstall 脚本自己跑只会报错/白下载引擎 ⇒ 统一在后面显式生成。
RUN npm ci --ignore-scripts --no-audit --no-fund

# ② 源码层
COPY backend/ai/tsconfig.json backend/ai/tsconfig.build.json ./
COPY backend/ai/src ./src
# ③ prisma schema（`prisma generate` 要它；**不拷进运行时镜像** ⇒ 运行时不需要 schema）
COPY backend/ai/prisma ./prisma

# ④ 生成 prisma 客户端（**必须在 tsc 之前**）
#    ⚠️ **顺序很重要**：`@prisma/client` 的类型是从 `.prisma/client` 里 re-export 的
#    ⇒ 客户端没生成时 `tsc` 会报 "Module '@prisma/client' has no exported member 'PrismaClient'"。
#    ⚠️ **必须在构建阶段做**：prisma CLI 是 devDependency，运行时镜像里没有它 ⇒ 生成的产物拷过去。
#    ⚠️ DATABASE_URL 给个假的：generate 只读 schema，不需要真库（真口令绝不入镜像）。
ENV DATABASE_URL=mysql://build:build@127.0.0.1:3306/build
RUN npx prisma generate && ls -la node_modules/.prisma/client | head -20

# ⑤ 编译：tsc ⇒ dist/（ESM，pi SDK 是 ESM-only ⇒ 必须是 ESM）
RUN npm run build

# ─────────────────────────── 运行阶段 ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="ai-admin-ai" \
      org.opencontainers.image.description="AiAdmin AI 编排服务（Express 5 + pi SDK + Prisma）" \
      org.opencontainers.image.source="https://github.com/wenanguo/ai-admin-com"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3100

# ① 生产依赖：只有 dependencies，**没有 devDependencies**（验收标准要求）
#    ⚠️ --ignore-scripts：@prisma/client 的 postinstall 想自己 generate
#    ⇒ 容器里没有 schema、没有 prisma CLI ⇒ 会失败 ⇒ 跳过；
#    生成好的客户端从构建阶段拷过来（下一行）。
COPY backend/ai/package.json backend/ai/package-lock.json ./
RUN npm install -g npm@10.9.9 && npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ② 编译产物（ESM）
COPY --from=builder /app/dist ./dist

# ③ prisma 生成的客户端（**npm ci 会清空 node_modules ⇒ 必须从构建阶段拷**）
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# ④ 技能（**cwd 相对** ⇒ 必须和 WORKDIR 保持同一个相对位置）
#    ⚠️ `load_skill` / `/api/agent/skills` 都按 `join(process.cwd(), ".pi", "skills")` 找
#    ⇒ WORKDIR=/app ⇒ 技能必须在 /app/.pi/skills ✔
COPY backend/ai/.pi ./.pi

EXPOSE 3100

# 健康检查：打 /health（**恒 200** ⇒ 依赖挂了不会把容器判死，只体现在 status 字段里）
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ⚠️ **不用 `--env-file=.env`**：容器里没有 .env（凭据用环境变量/挂载给）
#    ⇒ `node --env-file=.env dist/main.js` 会因缺文件直接退出。
#    `src/load-env.ts` 已经会「有就读、没有就用进程环境变量」。
CMD ["node", "dist/main.js"]
