export default function Home() {
	return (
		<main>
			<h1>Task 1 风险尖峰</h1>
			<ul>
				<li>
					<a href="/api/spike/agent">/api/spike/agent</a> —— pi SDK 在 Route Handler 里跑一次真实模型调用
				</li>
				<li>
					<a href="/api/spike/sse">/api/spike/sse</a> —— Route Handler 逐秒推 SSE 帧
				</li>
			</ul>
		</main>
	);
}
