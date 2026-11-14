@echo off
REM ============================================================
REM AiAdmin 部署脚本（Windows 版）
REM
REM   docker\deploy.bat            ^>^> 默认只检查（不改任何东西）
REM   docker\deploy.bat --yes      ^>^> 真执行
REM
REM ⚠️ 与 deploy.sh 的差别：Windows 上没有 bash ⇒ 这里只做**核心几步**，
REM    少了「等 healthy 的详细轮询」与「失败回退提示」的完整逻辑。
REM    ⚠️ 推荐：**在 WSL / Git Bash 里用 deploy.sh**（功能完整）；
REM       本 .bat 是给「只有 Docker Desktop」的机器用的应急版本。
REM ⚠️ 不打印任何环境变量的值。
REM ============================================================
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.yaml"
set "ENV_FILE=%SCRIPT_DIR%.env"
set "MODE=check"

if /I "%~1"=="--yes" set "MODE=yes"
if /I "%~1"=="--check" set "MODE=check"

echo.
echo ===== 检查（只读，不改任何东西）=====

where git >nul 2>&1
if errorlevel 1 (
  echo [FAIL] 缺少依赖：git
  exit /b 1
)
where docker >nul 2>&1
if errorlevel 1 (
  echo [FAIL] 缺少依赖：docker（装 Docker Desktop）
  exit /b 1
)
docker compose version >nul 2>&1
if errorlevel 1 (
  echo [FAIL] 缺少依赖：docker compose（插件）
  exit /b 1
)
if not exist "%ENV_FILE%" (
  echo [FAIL] 没有 %ENV_FILE%
  echo        先复制占位清单再填真值：copy "%SCRIPT_DIR%.env.example" "%ENV_FILE%"
  exit /b 1
)
echo [ OK ] 依赖检查通过（docker / docker compose / git）

for /f "delims=" %%c in ('git -C "%~dp0.." rev-parse --short HEAD') do set "COMMIT=%%c"
echo 仓库 commit：%COMMIT%
echo compose 文件：%COMPOSE_FILE%
echo.
echo 部署请用：docker\deploy.bat --yes

if /I "%MODE%"=="check" exit /b 0

REM ──────────── 真执行 ────────────
echo.
echo ===== 部署（会改状态）=====
echo [INFO] 拉最新代码
git -C "%~dp0.." pull --ff-only
if errorlevel 1 (
  echo [FAIL] git pull 失败
  echo        回退：git -C "%~dp0.." reset --hard ^<上一个 commit^> ^&^& docker compose -f "%COMPOSE_FILE%" up -d --build
  exit /b 1
)

echo [INFO] 构建镜像
docker compose -f "%COMPOSE_FILE%" build
if errorlevel 1 (
  echo [FAIL] 镜像构建失败
  echo        回退：git -C "%~dp0.." reset --hard ^<上一个 commit^> ^&^& docker compose -f "%COMPOSE_FILE%" up -d --build
  exit /b 1
)

echo [INFO] 起服务
docker compose -f "%COMPOSE_FILE%" up -d
if errorlevel 1 (
  echo [FAIL] 服务启动失败
  echo        回退：git -C "%~dp0.." reset --hard ^<上一个 commit^> ^&^& docker compose -f "%COMPOSE_FILE%" up -d --build
  exit /b 1
)

echo [INFO] 等容器 healthy（最多 300 秒）
set /a WAITED=0
:WAIT_LOOP
set /a WAITED+=3
if !WAITED! GTR 300 (
  echo [FAIL] 容器没在 300 秒内 healthy
  docker compose -f "%COMPOSE_FILE%" logs --tail 60 web ai
  exit /b 1
)
set /a NOTHEALTHY=0
for /f "usebackq tokens=* delims=" %%s in (`docker compose -f "%COMPOSE_FILE%" ps -q`) do (
  for /f "usebackq tokens=* delims=" %%h in (`docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" %%s`) do (
    if /I not "%%h"=="healthy" set /a NOTHEALTHY+=1
  )
)
if !NOTHEALTHY! GTR 0 (
  timeout /t 3 /nobreak >nul
  goto WAIT_LOOP
)
echo [ OK ] 两个容器都 healthy

for /f "delims=" %%c in ('git -C "%~dp0.." rev-parse --short HEAD') do set "COMMIT=%%c"
> "%SCRIPT_DIR%.last-deploy" echo %COMMIT% %DATE% %TIME%

echo.
echo ===== 部署完成 =====
echo   commit   : %COMMIT%
echo   镜像     : ai-admin-web:latest / ai-admin-ai:latest
echo   访问地址 : http://localhost:8080/
endlocal
