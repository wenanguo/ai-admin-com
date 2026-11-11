/**
 * 进程入口 —— `node dist/main.js` 就是这个服务。
 *
 * ⚠️ 为什么不直接用 `server.ts`：`server.ts` 导出 `createApp()`，
 *    **测试要 import 它** ⇒ 不能在 import 时就监听端口。
 *    所以单独一个入口文件负责「启动」。
 *
 * ⚠️ `load-env.ts` **必须排在第一个**：它负责把 `.env` 读进环境变量，
 *    而 `server.ts` ⇒ `env.ts` 在 import 时就要校验环境变量（见 `load-env.ts` 的说明）。
 */

import "./load-env.ts";
import { start } from "./server.ts";

start();
