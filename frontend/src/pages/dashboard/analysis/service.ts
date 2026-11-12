/**
 * 看板的**演示数据**。
 *
 * ⚠️ 原来这里发的是 `GET /api/fake_analysis_chart_data` —— 那个接口**只在
 *    umi 的 mock 里存在**（开发模式）：
 * - `npm run dev`（连真后端、不开 mock）⇒ 404；
 * - 生产构建里没有 mock ⇒ 同样 404
 *   ⇒ 看板打开就是「Not Found」。
 *
 * ⇒ 改成直接调本地函数：不发请求 ⇒ 任何环境都能出图。
 */
import type { AnalysisData } from './data';
import { getFakeChartData } from './demoData';

/**
 * 取一份演示数据。
 *
 * @returns 演示数据（包在 `data` 里，与原来那个假接口的返回形状一致）。
 */
export async function fakeChartData(): Promise<{ data: AnalysisData }> {
  return { data: getFakeChartData() };
}
