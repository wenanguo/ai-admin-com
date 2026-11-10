/**
 * 「与 AI 讨论 → 回填」的**真实验收**脚本（一次性工具，跑完即弃）。
 *
 * 步骤：
 * 1. 从 AiAdmin 拉任务 #6（真实后端）；
 * 2. 组上下文 ⇒ 建会话 ⇒ 发一句「这条做完了」；
 * 3. 盯 SSE ⇒ 看到工具调用与待确认；
 * 4. 批准 ⇒ 等写回；
 * 5. 再拉一次任务 ⇒ 核对 actual_hours / description 真的变了。
 *
 * 用法：node scripts/e2e-discuss.mjs
 */

import { readFileSync } from "node:fs";

const AI = process.env.AI_BASE ?? "http://localhost:3100";
const ADMIN = process.env.ADMIN_BASE ?? "https://www.pmdict.cn/api/v1";
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? "D:/tmp/token.txt", "utf8").trim();
const TASK_ID = Number(process.env.TASK_ID ?? 6);

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

/** 读 SSE 帧。 */
async function* sse(url) {
	const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let index;
		while ((index = buffer.indexOf("\n\n")) >= 0) {
			const chunk = buffer.slice(0, index);
			buffer = buffer.slice(index + 2);
			const data = chunk
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.join("");
			const event = chunk
				.split("\n")
				.find((line) => line.startsWith("event:"))
				?.slice(6)
				.trim();
			if (data.length === 0) continue;
			try {
				yield { event, data: JSON.parse(data) };
			} catch {
				yield { event, data };
			}
		}
	}
}

/** 拉任务。 */
async function fetchTask(id) {
	const res = await fetch(`${ADMIN}/pm_project/pm_task/detail/${id}`, { headers });
	const body = await res.json();
	return body.data;
}

const task = await fetchTask(TASK_ID);
console.log("任务基线：", {
	id: task.id,
	title: task.title,
	status_code: task.status_code,
	actual_hours: task.actual_hours,
	description: task.description,
});

const context = {
	task: {
		id: task.id,
		project_id: task.project_id,
		milestone_id: task.milestone_id,
		parent_id: task.parent_id,
		title: task.title,
		description: task.description,
		type_code: task.type_code,
		status_code: task.status_code,
		priority_code: task.priority_code,
		estimate_hours: task.estimate_hours,
		actual_hours: task.actual_hours,
		assignee_id: task.assignee_id,
		reviewers: task.reviewers,
		labels: task.labels,
		start_date: task.start_date,
		due_date: task.due_date,
		actual_start_date: task.actual_start_date,
		actual_end_date: task.actual_end_date,
		blocked_reason: task.blocked_reason,
	},
	labels: { in_progress: "进行中", done: "已完成", todo: "待办" },
	names: { assignee: "验收员" },
	project: { id: task.project_id, name: `项目 ${task.project_id}` },
	milestone: { id: task.milestone_id ?? 0, name: `里程碑 ${task.milestone_id ?? 0}` },
};

const conv = await (
	await fetch(`${AI}/api/agent/conversations`, {
		method: "POST",
		headers,
		body: JSON.stringify({ title: "验收：与 AI 讨论" }),
	})
).json();
const cid = conv.data.conversationId;
console.log("会话：", cid);

const events = sse(`${AI}/api/agent/${cid}/events`);
const seen = [];
const done = (async () => {
	for await (const frame of events) {
		const name = frame.event;
		seen.push(frame);
		console.log("·", name, JSON.stringify(frame.data).slice(0, 300));
		if (name === "pending") {
			const id = frame.data?.id;
			console.log("⇒ 待确认：", id, "⇒ 批准");
			const res = await fetch(`${AI}/api/agent/pending/${id}/approve`, {
				method: "POST",
				headers,
				body: "{}",
			});
			console.log("批准结果：", res.status, JSON.stringify(await res.json()));
		}
	}
})();

await new Promise((r) => setTimeout(r, 300));
await fetch(`${AI}/api/agent/${cid}/command`, {
	method: "POST",
	headers,
	body: JSON.stringify({
		id: `cmd-${Date.now()}`,
		type: "prompt",
		message: "这条任务其实已经做完了，实际工时 8 小时，完成说明：联调已通过，回归无问题。麻烦回填一下。",
		context,
	}),
});

await new Promise((r) => setTimeout(r, 120000));
console.log(
	"=== 关键事件 ===",
	JSON.stringify(
		seen.filter((f) =>
			["tool_call", "tool_result", "entity_updated", "message_end"].includes(f.event),
		),
		null,
		1,
	),
);

const after = await fetchTask(TASK_ID);
console.log("写回后：", {
	actual_hours: after.actual_hours,
	description: after.description,
	status_code: after.status_code,
});
