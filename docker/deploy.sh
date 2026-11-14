#!/usr/bin/env bash
#
# AiAdmin 部署脚本（一条命令：拉代码 → 构建镜像 → 起服务 → 等健康 → 出摘要）
#
#   bash docker/deploy.sh            # **默认只检查**（不改任何东西）
#   bash docker/deploy.sh --check    # 同上（显式写法）
#   bash docker/deploy.sh --yes      # 真执行
#
# ## 为什么默认只检查
#
# 部署是**公共动作**（会改线上状态）⇒ 与仓库里的 `scripts/agent/merge-pr.cjs` 一个脾气：
# **要显式确认才动手**。`--check` 只读，不写、不拉、不构建。
#
# ## 幂等
#
# 再跑一次不会报错，也不会重建没变化的东西：
#   · `docker compose build` 有层缓存 ⇒ 只有变化的层会重建；
#   · `docker compose up -d` 只有配置/镜像变了才重建容器。
#
# ## 失败可回退
#
# 任何一步失败 ⇒ 打印**怎么回退**（`git reset --hard <上一个 commit>` + `docker compose up -d`），
# 而不是留下半死不活的状态。
#
# ⚠️ **不把凭据写进日志**：只打印环境变量的**名字**，绝不打印值；
#    也不跑 `docker compose config`（它会把解析后的环境变量全打出来）。
#
# ⚠️ **不针对任何特定服务器 / 域名**：目标机由使用者给（SSH 上去跑就行）。
set -euo pipefail

# ─────────────────────────── 路径 ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yaml"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"
STATE_FILE="${SCRIPT_DIR}/.last-deploy"

# 等两个容器 healthy 的最长时间（秒）
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"

# ─────────────────────────── 日志 ───────────────────────────
if [ -t 1 ]; then
  C_BLUE='\033[0;34m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[0;33m'; C_RED='\033[0;31m'; C_RESET='\033[0m'
else
  C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi

log()  { echo -e "${C_BLUE}[$(date '+%H:%M:%S')] [INFO] ${1}${C_RESET}"; }
ok()   { echo -e "${C_GREEN}[$(date '+%H:%M:%S')] [ OK ] ${1}${C_RESET}"; }
warn() { echo -e "${C_YELLOW}[$(date '+%H:%M:%S')] [WARN] ${1}${C_RESET}"; }
err()  { echo -e "${C_RED}[$(date '+%H:%M:%S')] [FAIL] ${1}${C_RESET}" >&2; }

usage() {
  cat <<'USAGE'
用法：
  bash docker/deploy.sh            # 默认：只检查，不改任何东西
  bash docker/deploy.sh --check    # 同上
  bash docker/deploy.sh --yes      # 真执行（拉代码 → 构建 → 起服务 → 等健康）

选项：
  --check   只检查（默认）
  --yes     真执行部署
  -h/--help 显示本帮助

环境变量：
  HEALTH_TIMEOUT  等容器 healthy 的超时秒数（默认 300）
USAGE
}

# ─────────────────────────── 参数 ───────────────────────────
MODE="check"
for arg in "$@"; do
  case "${arg}" in
    --check) MODE="check" ;;
    --yes)   MODE="yes" ;;
    -h|--help) usage; exit 0 ;;
    *) err "未知参数：${arg}"; usage; exit 2 ;;
  esac
done

# ─────────────────────────── 依赖检查 ───────────────────────────
# 缺什么就**明确报缺什么**（一次全报出来，别挤牙膏）。
check_deps() {
  local missing=()
  local warns=()

  command -v git   >/dev/null 2>&1 || missing+=("git")
  command -v docker >/dev/null 2>&1 || missing+=("docker")

  if command -v docker >/dev/null 2>&1; then
    docker compose version >/dev/null 2>&1 || missing+=("docker compose（插件）")
    docker info >/dev/null 2>&1 || warns+=("docker 守护进程没起来（Docker Desktop / dockerd 启动了吗？）")
  fi

  # Node：部署本身**不需要**宿主机有 node（构建在镜像里做），
  #   但本机跑验收脚本需要 node ≥ 22 ⇒ 缺失/太旧只当警告，但要**说清楚**。
  if ! command -v node >/dev/null 2>&1; then
    warns+=("node 没装（部署本身不需要；但本机跑 scripts/e2e/** 的验收脚本需要 node ≥ 22）")
  else
    local node_major
    node_major="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
    if [ -n "${node_major}" ] && [ "${node_major}" -lt 22 ] 2>/dev/null; then
      warns+=("node 版本 $(node -v) < 22（部署本身不需要；但本机跑验收脚本需要 node ≥ 22）")
    fi
  fi

  if [ "${#missing[@]}" -gt 0 ]; then
    err "缺少依赖：${missing[*]}"
    for m in "${missing[@]}"; do
      case "${m}" in
        git) echo "        · git：装 git，或确认它在 PATH 里" >&2 ;;
        docker) echo "        · docker：装 Docker Engine / Docker Desktop" >&2 ;;
        *) echo "        · ${m}" >&2 ;;
      esac
    done
    return 1
  fi
  ok "依赖检查通过（docker / docker compose / git）"

  for w in "${warns[@]}"; do
    warn "${w}"
  done
  return 0
}

# ─────────────────────────── 环境变量 ───────────────────────────
# AI 服务启动时强校验的几个变量（缺一个 ⇒ 容器起不来）。
# ⚠️ 只检查**有没有值**，**不打印值**。
REQUIRED_ENV_VARS=(DATABASE_URL MINIMAX_CN_API_KEY AIADMIN_BASE_URL ALLOWED_ORIGINS)

load_env() {
  if [ ! -f "${ENV_FILE}" ]; then
    if [ -f "${ENV_EXAMPLE}" ]; then
      err "没有 ${ENV_FILE}"
      echo "        · 先复制占位清单再填真值：cp ${ENV_EXAMPLE} ${ENV_FILE}" >&2
    else
      err "没有 ${ENV_FILE}（也没有 ${ENV_EXAMPLE}）"
    fi
    return 1
  fi
  # shellcheck disable=SC1090
  set -a; . "${ENV_FILE}"; set +a

  local missing=()
  for v in "${REQUIRED_ENV_VARS[@]}"; do
    [ -n "${!v:-}" ] || missing+=("${v}")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    err "${ENV_FILE} 里这些变量还没填：${missing[*]}"
    echo "        · 只填值，不要把变量名以外的日志打出来（脚本不会打印值）" >&2
    return 1
  fi
  ok "环境变量已加载（${#REQUIRED_ENV_VARS[@]} 个必需变量都有值；**值不打印**）"
  return 0
}

# ─────────────────────────── 状态 ───────────────────────────
current_commit() { git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "unknown"; }
current_branch() { git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"; }

# 上次成功部署的 commit（没有就空）
last_deploy() {
  [ -f "${STATE_FILE}" ] || return 0
  # 文件第一行：`<commit> <时间戳>`
  head -n 1 "${STATE_FILE}" 2>/dev/null || true
}

# ─────────────────────────── 检查模式 ───────────────────────────
do_check() {
  echo
  log "===== 检查（只读，不改任何东西）====="

  check_deps || return 1
  load_env || return 1

  log "仓库：${REPO_ROOT}（分支 ${current_branch()}，commit $(current_commit)）"
  local last; last="$(last_deploy)"
  if [ -n "${last}" ]; then
    log "上次成功部署：${last}"
  else
    log "上次成功部署：无记录（首次部署）"
  fi

  log "compose 文件：${COMPOSE_FILE}"
  if [ -f "${COMPOSE_FILE}" ]; then
    # ⚠️ 只列服务名：**不跑 `docker compose config`**（它会把环境变量的值打出来）
    if command -v docker >/dev/null 2>&1; then
      local services
      services="$(docker compose -f "${COMPOSE_FILE}" config --services 2>/dev/null || echo "(读不到，可能 docker 没起)")"
      log "服务：${services}"
    fi
  else
    err "找不到 compose 文件：${COMPOSE_FILE}"
    return 1
  fi

  echo
  log "将要做的（加 --yes 才执行）："
  echo "        1) git pull --ff-only（拉最新代码）"
  echo "        2) docker compose build（构建镜像；层缓存 ⇒ 没变化不重建）"
  echo "        3) docker compose up -d（起服务；配置没变不重建容器）"
  echo "        4) 等两个容器 healthy（最多 ${HEALTH_TIMEOUT}s）"
  echo "        5) 写 ${STATE_FILE}（记录 commit，供回退用）并打印摘要"
  echo
  ok "检查通过。执行部署请用：bash docker/deploy.sh --yes"
  return 0
}

# ─────────────────────────── 部署模式 ───────────────────────────
# 失败时的回退提示（**一定要给得出怎么退回去**）。
print_rollback_hint() {
  local prev_commit="${1:-unknown}"
  echo >&2
  err "部署没成功 ⇒ 怎么回退："
  echo "        # 1) 代码回到部署前那个 commit" >&2
  echo "        git -C ${REPO_ROOT} reset --hard ${prev_commit}" >&2
  echo "        # 2) 用回退后的代码重新起服务" >&2
  echo "        docker compose -f ${COMPOSE_FILE} up -d --build" >&2
  echo "        # 3) 看状态" >&2
  echo "        docker compose -f ${COMPOSE_FILE} ps" >&2
  echo >&2
}

# 等某个服务的容器 healthy
wait_healthy() {
  local service="$1"
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "${deadline}" ]; do
    local cid status
    cid="$(docker compose -f "${COMPOSE_FILE}" ps -q "${service}" 2>/dev/null || true)"
    if [ -n "${cid}" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${cid}" 2>/dev/null || echo unknown)"
      case "${status}" in
        healthy) ok "${service} 容器 healthy"; return 0 ;;
        unhealthy) warn "${service} 容器 unhealthy（继续等 ⇒ 最多 ${HEALTH_TIMEOUT}s）" ;;
      esac
    fi
    sleep 3
  done
  return 1
}

do_deploy() {
  local prev_commit; prev_commit="$(current_commit)"
  echo
  log "===== 部署（会改状态）====="

  check_deps || { print_rollback_hint "${prev_commit}"; return 1; }
  load_env || { print_rollback_hint "${prev_commit}"; return 1; }

  # ① 拉最新代码
  log "① 拉最新代码"
  if ! git -C "${REPO_ROOT}" pull --ff-only; then
    err "git pull 失败（有本地改动？）"
    print_rollback_hint "${prev_commit}"
    return 1
  fi
  local new_commit; new_commit="$(current_commit)"
  if [ "${new_commit}" != "${prev_commit}" ]; then
    log "代码有更新：${prev_commit} → ${new_commit}"
  else
    log "代码没变化（${new_commit}）"
  fi

  # ② 构建镜像
  log "② 构建镜像（有层缓存 ⇒ 没变化不重建）"
  if ! docker compose -f "${COMPOSE_FILE}" build; then
    err "镜像构建失败"
    print_rollback_hint "${prev_commit}"
    return 1
  fi

  # ③ 起服务
  log "③ 起服务"
  if ! docker compose -f "${COMPOSE_FILE}" up -d; then
    err "服务启动失败"
    print_rollback_hint "${prev_commit}"
    return 1
  fi

  # ④ 等 healthy
  log "④ 等容器 healthy"
  local failed=0
  for svc in web ai; do
    if ! wait_healthy "${svc}"; then
      err "${svc} 容器没在 ${HEALTH_TIMEOUT}s 内 healthy"
      failed=1
    fi
  done
  if [ "${failed}" -ne 0 ]; then
    err "服务没全部健康 ⇒ 日志在下面（自己看，不含凭据）"
    docker compose -f "${COMPOSE_FILE}" logs --tail 60 web ai >&2 || true
    print_rollback_hint "${prev_commit}"
    return 1
  fi

  # ⑤ 记状态 + 摘要
  local web_port; web_port="${WEB_PORT:-8080}"
  {
    echo "${new_commit} $(date '+%Y-%m-%d %H:%M:%S')"
    echo "branch=$(current_branch)"
    echo "images=ai-admin-web:latest,ai-admin-ai:latest"
  } > "${STATE_FILE}"

  echo
  ok "===== 部署完成 ====="
  echo "  commit    : ${new_commit}（分支 ${current_branch()}）"
  echo "  镜像      : ai-admin-web:latest / ai-admin-ai:latest"
  echo "  容器状态  :"
  docker compose -f "${COMPOSE_FILE}" ps --format '               {{.Service}}  {{.State}}  {{.Status}}' 2>/dev/null || true
  echo "  访问地址  : http://<本机或服务器 IP>:${web_port}/"
  echo "  健康检查  : http://<本机或服务器 IP>:${web_port}/healthz"
  echo
  log "状态记录在 ${STATE_FILE}（回退提示会用它）"
  return 0
}

# ─────────────────────────── 入口 ───────────────────────────
case "${MODE}" in
  check) do_check ;;
  yes)   do_deploy ;;
esac
