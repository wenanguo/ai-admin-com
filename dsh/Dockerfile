# syntax=docker/dockerfile:1
#
# 独立 dsh 项目的镜像（issue #183）
#
#   构建上下文 = **仓根**（插件源码在 backend/ai/dsh-plugin ⇒ 要一起拷进来）：
#     docker build -f dsh/Dockerfile -t dsh-standalone .
#
#   跑（一句话任务 ⇒ headless 模式 ⇒ 打印结果就退出）：
#     docker run --rm -e MINIMAX_CN_API_KEY=你的key dsh-standalone "用一句话回答：1+1 等于几？"
#
# ⚠️ **构建阶段不读 .env、不带任何凭据** ⇒ 构建机上不需要私有信息。
# ⚠️ **凭据只在运行时用环境变量给** ⇒ 密钥**不进镜像**（镜像里只有变量名）。
# ⚠️ **profile 在构建阶段预热**（插件装好了）⇒ **运行时不需要联网**。
# ============================================================

ARG NODE_VERSION=24
ARG NPM_VERSION=10.9.9
ARG PNPM_VERSION=11.22.0

# ─────────────────────────── 构建阶段 ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /app

ENV HUSKY=0 \
    CI=true

# 钉住 npm 版本（与仓库 CI / 其它镜像一致：npm 10.9.9）
RUN node -v && npm install -g npm@${NPM_VERSION} && npm -v

# ⚠️ **要 pnpm**（dsh 的 profile 是独立的 pnpm 工程 ⇒ 装插件要 pnpm）
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm -v

# ① 依赖层：先只拷清单 ⇒ 改源码不会让 npm ci 这一层失效
COPY dsh/package.json dsh/package-lock.json ./dsh/
RUN cd dsh && npm ci --no-audit --no-fund

# ② 源码层
COPY dsh/scripts ./dsh/scripts
# ③ **外部插件的源码**（按 file: 引用装进 profile ⇒ 镜像里也要有它）
COPY backend/ai/dsh-plugin ./backend/ai/dsh-plugin

# ④ **预热 profile**：建 profile + 把插件装进去
#    ⚠️ 插件的依赖（@deepseek-ai/*）会在这一步进 profile 的 node_modules
#    ⇒ **运行时不需要联网** ⇒ 容器起得快、也不怕断网。
ENV STANDALONE_HOME=/app/.dsh-home
RUN cd dsh && node scripts/bootstrap.mjs

# ─────────────────────────── 运行阶段 ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="dsh-standalone" \
      org.opencontainers.image.description="独立的 dsh 项目（DeepSeek Harness）—— 自己装、自己连 MiniMax" \
      org.opencontainers.image.source="https://github.com/wenanguo/ai-admin-com"

WORKDIR /app

ENV NODE_ENV=production \
    STANDALONE_HOME=/app/.dsh-home

RUN npm install -g npm@${NPM_VERSION} && npm -v

# ① 生产依赖（**这个项目的依赖不进本仓** ⇒ 自己的 lock、自己的 node_modules）
COPY dsh/package.json dsh/package-lock.json ./dsh/
RUN cd dsh && npm ci --omit=dev --no-audit --no-fund

# ② 脚本与模板
COPY dsh/scripts ./dsh/scripts
COPY dsh/.env.example ./dsh/.env.example

# ③ **外部插件的源码**（镜像里的路径要跟引导时写进 profile 状态的那份一致
#    ⇒ 否则会判定「插件变了」⇒ 想重装 ⇒ 运行时要联网）
COPY backend/ai/dsh-plugin ./backend/ai/dsh-plugin

# ④ **预热好的 profile**（含插件拷贝与状态文件 ⇒ 运行时免联网）
COPY --from=builder /app/.dsh-home ./.dsh-home

# ⚠️ **凭据只从环境变量读** ⇒ 这里没有 .env ⇒ 用 `-e MINIMAX_CN_API_KEY=…` 给。
ENTRYPOINT ["node", "dsh/scripts/chat.mjs"]
CMD ["用一句话回答：1+1 等于几？"]
