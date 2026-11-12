/**
 * 看板的 mock 接口（**开发模式**下由 umi 的 mock 插件提供）。
 *
 * ⚠️ 数据本身在 `demoData.ts` 里 —— 看板页面**直接调那个本地函数**，
 *    不走这个接口（这个接口在生产构建里不存在 ⇒ 走它就 404）。
 *    这里保留它只是为了兼容「有人还在用这个假接口」的情况。
 */
import type { Request, Response } from 'express';
import { getFakeChartData } from './demoData';

const fakeChartData = (_: Request, res: Response) => {
  return res.json({
    data: getFakeChartData(),
  });
};

export default {
  'GET  /api/fake_analysis_chart_data': fakeChartData,
};
