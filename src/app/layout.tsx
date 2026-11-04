import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "AIPM AI 服务 · 尖峰",
	description: "Task 1 风险尖峰：pi SDK / SSE / Prisma 三个不确定点的实测",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="zh-CN">
			<body style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>{children}</body>
		</html>
	);
}
