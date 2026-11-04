import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// pi SDK 带 node:fs / jiti / quickjs-wasi 等原生/动态依赖，
	// 不能让 Next 打包器处理，否则运行时报错。让它在 Node 运行时直接 require。
	serverExternalPackages: [
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-codemode",
		"@earendil-works/pi-mcp",
		"@earendil-works/pi-tui",
		"typebox",
	],
};

export default nextConfig;
