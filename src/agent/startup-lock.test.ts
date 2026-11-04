import { describe, expect, it } from "vitest";
import { StartupLock } from "./startup-lock";

/** 等一小会儿（毫秒）。 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("启动锁", () => {
	it("同一个 key 的任务串行执行（第二个等第一个跑完）", async () => {
		const lock = new StartupLock();
		const order: string[] = [];

		const first = lock.run("conv-1", async () => {
			order.push("第一个:开始");
			await sleep(20);
			order.push("第一个:结束");
			return "一";
		});
		const second = lock.run("conv-1", async () => {
			order.push("第二个:开始");
			return "二";
		});

		expect(await Promise.all([first, second])).toEqual(["一", "二"]);
		expect(order).toEqual(["第一个:开始", "第一个:结束", "第二个:开始"]);
	});

	it("不同 key 的任务并行执行", async () => {
		const lock = new StartupLock();
		const order: string[] = [];

		const first = lock.run("conv-1", async () => {
			order.push("甲:开始");
			await sleep(30);
			order.push("甲:结束");
		});
		const second = lock.run("conv-2", async () => {
			order.push("乙:开始");
			await sleep(5);
			order.push("乙:结束");
		});

		await Promise.all([first, second]);
		// 乙在甲结束前就结束了 ⇒ 没有被甲堵住
		expect(order).toEqual(["甲:开始", "乙:开始", "乙:结束", "甲:结束"]);
	});

	it("前一个任务失败不影响后一个（失败也要放行队列）", async () => {
		const lock = new StartupLock();
		const order: string[] = [];

		const failing = lock.run("conv-1", async () => {
			order.push("坏的:开始");
			throw new Error("模型报错了");
		});
		const following = lock.run("conv-1", async () => {
			order.push("好的:开始");
			return "成功";
		});

		await expect(failing).rejects.toThrow("模型报错了");
		expect(await following).toBe("成功");
		expect(order).toEqual(["坏的:开始", "好的:开始"]);
	});

	it("跑完后不留尾巴（不会漏内存）", async () => {
		const lock = new StartupLock();
		await lock.run("conv-1", async () => "一");
		await lock.run("conv-1", async () => "二");
		expect(lock.pendingKeys).toBe(0);
	});

	it("失败的尾巴也不会留在表里", async () => {
		const lock = new StartupLock();
		await expect(
			lock.run("conv-1", async () => {
				throw new Error("炸了");
			}),
		).rejects.toThrow("炸了");
		expect(lock.pendingKeys).toBe(0);
	});
});
