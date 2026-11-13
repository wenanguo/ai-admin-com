# syntax=docker/dockerfile:1
#
# AiAdmin 前端镜像（多阶段）
#
#   构建上下文 = **仓根**：
#     docker build -f docker/web/Dockerfile -t ai-admin-web .
#
#   阶段 1（builder）：node 22 → npm ci → max build ⇒ frontend/dist
#   阶段 2（runtime）：nginx 托管 dist（**镜像里只有构建产物**）
#
#   ⚠️ 构建阶段**不连后端、不读 .env** ⇒ 不需要任何私有凭据。
# ============================================================

ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27

# ─────────────────────────── 构建阶段 ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /app

# HUSKY=0：容器里没有 .git ⇒ 不装 git hooks
# CI=true：按 CI 模式构建
# NODE_OPTIONS：照抄仓库 CI 的构建参数（utoopack 打包吃内存）
ENV HUSKY=0 \
    CI=true \
    NODE_OPTIONS=--max_old_space_size=4096

# 可选：注入构建版本（frontend/config/config.ts 认 COMMIT_HASH；不给也不报错）
ARG COMMIT_HASH=""
ENV COMMIT_HASH=${COMMIT_HASH}

# ① 依赖层：先只拷清单文件 ⇒ 改源码不会让 npm ci 这一层失效
COPY frontend/package.json frontend/package-lock.json ./frontend/

# 打印版本 + **钉住 npm 版本**（构建日志里能看出用的是什么 node/npm）
#
# ⚠️ **为什么钉 npm 10.9.9**：
#    node:22 现在默认带 **npm 11** ⇒ 它的「package.json 与 package-lock.json 必须同步」
#    检查比 npm 10 严 ⇒ 本仓现有的 frontend/package-lock.json（npm 10 生成的）
#    会被 npm 11 判为不同步 ⇒ `npm ci` 直接 EUSAGE 失败
#    （报错长这样：Invalid: lock file's xxx does not satisfy ... / Missing: ... from lock file）。
#    ⇒ 钉到 **仓库 CI 正在用的 npm 10.9.9**（见 .github/workflows/ci.yml）⇒ 镜像与 CI 装出同一棵树。
RUN node -v && npm install -g npm@10.9.9 && npm -v

# ⚠️ --ignore-scripts：此刻源码还没拷进来，root 包的 prepare（husky + max setup）
#    会因为找不到 config/ 而失败 ⇒ 跳过脚本；esbuild 的安装脚本随后用 rebuild 补回来。
RUN cd frontend && npm ci --ignore-scripts --no-audit --no-fund

# ② 源码层
COPY frontend/ ./frontend/

# esbuild 的安装脚本负责把平台二进制就位（--ignore-scripts 跳过了它 ⇒ 补回来）
RUN cd frontend && npm rebuild esbuild

# ③ 构建：产物在 frontend/dist（= UMI_OUTPUT_PATH=dist max build）
RUN cd frontend && npm run build

# ─────────────────────────── 运行阶段 ───────────────────────────
FROM nginx:${NGINX_VERSION}-alpine AS runtime

LABEL org.opencontainers.image.title="ai-admin-web" \
      org.opencontainers.image.description="AiAdmin 前端静态站点（Umi 4 构建产物 + nginx 托管）" \
      org.opencontainers.image.source="https://github.com/wenanguo/ai-admin-com"

# 镜像自带的默认站点用不到（我们整份替换 nginx.conf）⇒ 删掉，免得误以为生效
RUN rm -f /etc/nginx/conf.d/default.conf

# 站点配置（整份主配置：日志到 stdout、gzip、安全头、缓存策略）
COPY docker/web/nginx.conf /etc/nginx/nginx.conf
COPY docker/web/snippets/ /etc/nginx/snippets/

# 只有构建产物进镜像（没有 node_modules、没有源码、没有凭据）
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

# 健康检查：打 /healthz（固定内容，不含版本信息）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]
