export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 尖峰 ②：Route Handler 能不能流式输出 SSE？
 *
 * 每秒推一帧 `data: {"n":1}\n\n`，最多 frames 帧（默认 10）后结束。
 * 客户端中途断开时，服务器端要能感知并安静收摊，不能崩。
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const frames = Number(url.searchParams.get("frames") ?? "10");
	const intervalMs = Number(url.searchParams.get("interval") ?? "1000");

	const encoder = new TextEncoder();
	let timer: ReturnType<typeof setInterval> | undefined;
	let closed = false;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let n = 0;
			const close = (reason: string) => {
				if (closed) return;
				closed = true;
				if (timer) clearInterval(timer);
				console.log(`[spike:sse] 关闭：${reason}（已发 ${n} 帧）`);
				try {
					controller.close();
				} catch {
					/* 已经断了 */
				}
			};

			timer = setInterval(() => {
				n += 1;
				const frame = `data: ${JSON.stringify({ n, ts: Date.now() })}\n\n`;
				try {
					controller.enqueue(encoder.encode(frame));
				} catch (error) {
					close(`enqueue 失败（客户端大概已断开）: ${String(error)}`);
					return;
				}
				console.log(`[spike:sse] 已发第 ${n} 帧`);
				if (n >= frames) close("达到帧数上限");
			}, intervalMs);

			request.signal.addEventListener("abort", () => close("收到客户端断开信号 (request.signal abort)"));
		},
		cancel() {
			closed = true;
			if (timer) clearInterval(timer);
			console.log("[spike:sse] 收到 cancel()（流被消费方取消）");
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
