# syntax=docker/dockerfile:1
#
# 「读书笔记」示例系统的镜像（issue #116：内核可复用的验收）
#
#   docker build -f backend/ai/examples/reading-notes/Dockerfile -t core-reuse-notes .
#
# ⚠️ **构建上下文 = 仓根**（要拿内核源码 `backend/ai/src` + prisma schema）。
# ⚠️ 这个镜像里**只有内核（core/）与示例自己的代码** ⇒ 没有 AiAdmin 的业务插件
#    （`backend/ai/src/plugins/**` 没被拷进来 ⇒ 镜像里也没有它）。
#
# ⚠️ 不用 alpine：prisma 的查询引擎在 musl 上要另配 openssl ⇒ 用 debian slim
#    （与 AI 服务镜像、前端镜像的 node 阶段一致）。
# ============================================================

ARG NODE_VERSION=22

# ─────────────────────────── 构建阶段 ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /app

ENV HUSKY=0 \
    CI=true

# 钉住 npm 版本（与仓库 CI / 其它镜像一致）
RUN node -v && npm install -g npm@10.9.9 && npm -v

# ① 依赖层：先只拷清单 ⇒ 改源码不会让 npm ci 这一层失效
COPY backend/ai/package.json backend/ai/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# ② 源码层：**内核**（core/）+ **示例**（examples/reading-notes/）
#    ⚠️ 只拷 `src/core` —— 示例只从公开入口进内核 ⇒ 用不到业务插件
COPY backend/ai/tsconfig.json backend/ai/tsconfig.build.json ./
COPY backend/ai/src/core ./src/core
COPY backend/ai/examples/reading-notes ./examples/reading-notes

# ③ prisma schema（`prisma generate` 要它）
COPY backend/ai/prisma ./prisma

# ④ 生成 prisma 客户端（**必须在 tsc 之前**）
ENV DATABASE_URL=mysql://build:build@127.0.0.1:3306/build
RUN npx prisma generate

# ⑤ 编译：示例 + 它引用的内核（ESM，pi SDK 是 ESM-only ⇒ 必须是 ESM）
#    ⚠️ **产物落在 `/app/examples/reading-notes/dist`** —— `outDir: "./dist"` 是相对
#       **示例自己的 tsconfig** 解析的（不是相对 WORKDIR）⇒ **不是 `/app/dist`**。
#    产物布局（相对那个 outDir）：`examples/reading-notes/main.js` + `src/core/**`
RUN npx tsc -p examples/reading-notes/tsconfig.json

# ─────────────────────────── 运行阶段 ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="core-reuse-reading-notes" \
      org.opencontainers.image.description="通用内核复用的示例系统（读书笔记，不依赖 AiAdmin）" \
      org.opencontainers.image.source="https://github.com/wenanguo/ai-admin-com"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3200

# ① 生产依赖 + **prisma CLI**（启动时要跑迁移 ⇒ 自己的空库要先建表）
#    ⚠️ **不**加 --ignore-scripts：`@prisma/client` 的 postinstall 要 generate
#    ⇒ schema 必须在 npm ci **之前**就在（下一行先拷）。
COPY backend/ai/package.json backend/ai/package-lock.json ./
COPY backend/ai/prisma ./prisma
ENV DATABASE_URL=mysql://notes:notes@127.0.0.1:3306/notes
RUN npm install -g npm@10.9.9 && npm ci --no-audit --no-fund

# ② 编译产物（示例 + 内核）
#    ⚠️ **源路径 = 构建阶段的真实产物目录**（`outDir` 相对示例的 tsconfig 解析
#       ⇒ `/app/examples/reading-notes/dist`，**不是 `/app/dist`**）
#    拷到运行阶段后是 `/app/dist` ⇒ 里面是 `examples/reading-notes/main.js` + `src/core/**`
#    ⇒ 与下面的 `CMD ["node", "dist/examples/reading-notes/main.js"]` 对得上。
COPY --from=builder /app/examples/reading-notes/dist ./dist

# ③ 智能体配置（**cwd 相对** ⇒ 必须和 WORKDIR 同一个相对位置）
#    ⚠️ 这是**示例自己的** agents/（不是 AiAdmin 的）
COPY backend/ai/examples/reading-notes/agents ./agents

EXPOSE 3200

# 健康检查：打 /health（**恒 200** ⇒ 依赖挂了也不会把容器判死）
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ⚠️ **先迁移再启动**：内核自己的 `ai_*` 表住在**示例自己的空库**里
#    （compose 里的 db 服务）⇒ 第一次启动要把表建出来。
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/examples/reading-notes/main.js"]
