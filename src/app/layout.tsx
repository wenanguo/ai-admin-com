import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "AIPM AI 服务",
	description: "用自然语言操作 AiAdmin：会话、命令、事件流",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="zh-CN">
			<body style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>{children}</body>
		</html>
	);
}
