/**
 * 首页 —— **不调模型、不链到会调模型的端点**。
 *
 * ⚠️ 这页以前是 Task 1 的尖峰落地页，链着 `/api/spike/agent`
 * （那个端点**每次 GET 都真的调一次模型**，没有鉴权、无限流 ⇒ 谁都能烧组织的 key）。
 * 尖峰端点已经从 `src/app/api/**` 里删掉了（脚本与结论留在 `spike/`）。
 *
 * 现在这页只做一件事：**说清楚这个服务对外是什么形状**（纯静态文字，无链接）。
 */
export default function Home() {
	return (
		<main>
			<h1>AIPM AI 服务</h1>
			<p>
				用自然语言操作 AiAdmin 的项目管理系统：把一句话变成一条真实存在的任务。
			</p>
			<h2>接口（都在 /api/agent 下，都要带 Authorization: Bearer &lt;token&gt;）</h2>
			<ul>
				<li>POST /api/agent/conversations —— 新建会话</li>
				<li>GET /api/agent/conversations —— 列会话</li>
				<li>POST /api/agent/:cid/command —— 提交命令（id / type / message）</li>
				<li>GET /api/agent/:cid/events —— SSE 事件流（要用 fetch + ReadableStream 读）</li>
				<li>GET /api/agent/:cid/state —— 会话快照</li>
			</ul>
			<p>
				本页只是服务的说明页；真正的能力在上面的接口里（详见仓库的 README）。
			</p>
		</main>
	);
}
