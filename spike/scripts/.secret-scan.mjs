import fs from "node:fs";
import { execSync } from "node:child_process";

const env = fs.readFileSync(".env", "utf8");
const key = env.match(/MINIMAX_CN_API_KEY=(.*)/)[1].trim();
const pwd = decodeURIComponent(new URL(env.match(/DATABASE_URL=(.*)/)[1].trim()).password);
const files = execSync("git diff --cached --name-only", { encoding: "utf8" })
	.split("\n")
	.filter(Boolean);

const leaks = [];
for (const f of files) {
	if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
	const t = fs.readFileSync(f, "utf8");
	if (t.includes(key)) leaks.push(`${f} [API KEY 明文]`);
	// 密码作为独立凭据出现（前后都不是字母数字/下划线）
	const re = new RegExp(`(?<![A-Za-z0-9_])${pwd}(?![A-Za-z0-9_])`, "g");
	if (re.test(t)) leaks.push(`${f} [DB 密码作为独立凭据]`);
	if (/mysql:\/\/[^:\s"']+:(?!\*\*\*)[^@\s"']+@/.test(t)) leaks.push(`${f} [连接串含明文密码]`);
}
console.log(
	leaks.length
		? "泄露:\n" + leaks.join("\n")
		: "干净：待提交文件中没有 API key、没有独立出现的 DB 密码、没有带明文密码的连接串",
);
console.log("（说明：DB 密码与同实例某个库名同形，所以 SHOW DATABASES 的输出在报告里也打了码）");
