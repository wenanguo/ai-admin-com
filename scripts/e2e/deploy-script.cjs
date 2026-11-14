/**
 * 部署脚本（`docker/deploy.sh`）—— 验收（**不需要 docker**）。
 *
 * ## 它验什么（= issue #41 的验收标准）
 *
 *   1. **默认只检查**：`bash docker/deploy.sh`（不带参数）**不改任何东西**
 *      （工作区不变、不写状态文件、不拉代码、不构建）
 *   2. `--check` / `--yes` 两种模式都在；`--help` 打印用法；未知参数报错
 *   3. 依赖检查：缺什么**明确报缺什么**（docker / docker compose / git / node）
 *   4. 失败有**回退提示**（`git reset --hard` + `docker compose up -d`）
 *   5. **不把凭据写进日志**（脚本不打印环境变量的值，也不跑会打印值的命令）
 *   6. `set -euo pipefail`；状态文件 `docker/.last-deploy` **不入库**
 *   7. Windows 有对应的 `docker/deploy.bat`
 *
 * ## 用法
 *
 *   node scripts/e2e/deploy-script.cjs
 *
 * ⚠️ 需要 **bash**（Windows 上用 Git Bash / WSL；CI 是 ubuntu ⇒ 有）。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'docker', 'deploy.sh');
const STATE_FILE = path.join(ROOT, 'docker', '.last-deploy');

const failures = [];
let passed = 0;

function check(label, ok, detail) {
	if (ok) {
		passed += 1;
		console.log(`  ✓ ${label}`);
		return;
	}
	failures.push(detail ? `${label} —— ${detail}` : label);
	console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
}

/** 跑一条命令（不抛错，返回 {status, stdout, stderr}）。 */
function tryRun(cmd, args, options = {}) {
	const res = spawnSync(cmd, args, {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
	return {
		status: res.status,
		stdout: (res.stdout || '').trim(),
		stderr: (res.stderr || '').trim(),
	};
}

/** 工作区当前状态（用来证明「检查模式没改任何东西」）。 */
function worktreeState() {
	const res = tryRun('git', ['status', '--porcelain']);
	return res.stdout;
}

// ───────────────────────────── 静态断言 ─────────────────────────────
console.log('\ndocker/deploy.sh（静态断言）');
const script = fs.readFileSync(SCRIPT, 'utf8');
check('文件存在', fs.existsSync(SCRIPT));
check('用了 set -euo pipefail', /set -euo pipefail/.test(script));
check('有 --check 与 --yes 两种模式', script.includes('--check') && script.includes('--yes'));
check('默认是 check（不传参数不动手）', /MODE="check"/.test(script));
check('有 --help / usage', script.includes('usage()') && script.includes('--help'));
check('失败有回退提示（git reset --hard + compose up -d）', /reset --hard/.test(script) && /compose .*up -d/.test(script));
check('检查了依赖（docker / compose / git / node）', ['docker compose version', 'command -v git', 'command -v node'].every((s) => script.includes(s)));
check('等容器 healthy（轮询 inspect）', script.includes('wait_healthy') && script.includes('.State.Health'));
check('写状态文件 docker/.last-deploy', script.includes('.last-deploy'));
// ⚠️ 不许打印凭据：既不能 cat .env，也不能 echo 变量值
//    （`docker compose config` 会把解析后的环境变量**连值一起**打出来 ⇒ 也不许跑；
//      `config --services` 只列服务名，是安全的）
const scriptCode = script
	.split(/\r?\n/)
	.filter((l) => !l.trim().startsWith('#'))
	.join('\n');
const printsValues = [
	/^\s*(cat|more|less|type)\s+.*\.env/m,
	/echo[^"]*\$\{?(DATABASE_URL|MINIMAX_CN_API_KEY|AIADMIN_MCP_URL)\}?/,
	/printenv/,
	/docker compose[^\n]*\bconfig\b(?! --services)/,
].filter((re) => re.test(scriptCode));
check('不打印凭据（不 cat .env / 不 echo 值 / 不跑 compose config）', printsValues.length === 0, printsValues.map(String).join(' | '));
check('没有 set -x（会把环境变量打进日志）', !/set -x/.test(script));

console.log('\ndocker/.last-deploy（状态文件）');
const ignored = tryRun('git', ['check-ignore', '-q', 'docker/.last-deploy']);
check('docker/.last-deploy 被 gitignore（不入库）', ignored.status === 0, 'git check-ignore 没命中');

console.log('\ndocker/deploy.bat（Windows 版）');
check('存在 deploy.bat', fs.existsSync(path.join(ROOT, 'docker', 'deploy.bat')));

// ───────────────────────────── 行为：检查模式不改任何东西 ─────────────────────────────
console.log('\n行为：bash docker/deploy.sh（默认 = 只检查）');
const bash = tryRun('bash', ['--version']);
if (bash.status !== 0) {
	console.log('  SKIP：本机没有 bash ⇒ 跳过行为断言（CI 是 ubuntu ⇒ 有）');
} else {
	const before = worktreeState();
	const stateExistedBefore = fs.existsSync(STATE_FILE);
	const res = tryRun('bash', ['docker/deploy.sh'], { env: { ...process.env, PATH: process.env.PATH } });
	const output = `${res.stdout}\n${res.stderr}`;

	// 退出码：0 = 检查通过；1 = 缺依赖（都算正常）
	check(
		'退出码是 0 或 1（不是崩溃）',
		res.status === 0 || res.status === 1,
		`status=${res.status}\n${output.slice(-800)}`,
	);
	check(
		'明确报出缺什么 / 检查通过',
		/缺少依赖/.test(output) || /依赖检查通过/.test(output),
		output.slice(-800),
	);
	// 「将要做的」清单只在**依赖齐全且 .env 齐了**时才会打印
	//（缺依赖 / 缺 .env ⇒ 提前停下并明确报出 ⇒ 那是正确行为）
	const depsOk = !/缺少依赖/.test(output);
	const envOk = !/没有 .*\.env/.test(output);
	check(
		depsOk && envOk ? '打印了「将要做的」清单' : '有前置问题时明确报出并停下',
		depsOk && envOk ? /将要做的/.test(output) : /缺少依赖/.test(output) || /没有 .*\.env/.test(output),
		output.slice(-800),
	);

	const after = worktreeState();
	check('**没有改动工作区**（git status 不变）', before === after, `前：${before.slice(0, 300)}\n后：${after.slice(0, 300)}`);
	check(
		'**没有写状态文件**（检查模式不落盘）',
		fs.existsSync(STATE_FILE) === stateExistedBefore,
		'docker/.last-deploy 被检查模式创建了',
	);
	check('没有执行 git pull（输出里没有 pull 的痕迹）', !/pull --ff-only/.test(output));

	console.log('\n行为：--help 与未知参数');
	const help = tryRun('bash', ['docker/deploy.sh', '--help']);
	check('--help 退出码 0 且打印用法', help.status === 0 && /用法/.test(help.stdout), help.stdout.slice(-300));
	const bad = tryRun('bash', ['docker/deploy.sh', '--nope']);
	check('未知参数 ⇒ 报错退出（码 2）', bad.status === 2, `status=${bad.status}`);
}

console.log('');
if (failures.length > 0) {
	console.error(`✗ 部署脚本验收失败 ${failures.length} 条（通过 ${passed} 条）：`);
	for (const f of failures) console.error(`   - ${f}`);
	process.exit(1);
}
console.log(`✓ 部署脚本验收全部通过（${passed} 条）`);
