import { describe, expect, it, vi } from 'vitest';
import { toProTableRequest } from './paginate';

describe('toProTableRequest', () => {
  it('maps ProTable current/pageSize to backend page_no/page_size', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: {
        items: [{ id: 1 }],
        total: 1,
        page_no: 2,
        page_size: 20,
        has_next: false,
      },
      status_code: 200,
      success: true,
    });

    const request = toProTableRequest(api);
    await request({ current: 2, pageSize: 20 });

    expect(api).toHaveBeenCalledWith({ page_no: 2, page_size: 20 });
  });

  it('defaults to page 1 and 10 rows', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({});

    expect(api).toHaveBeenCalledWith({ page_no: 1, page_size: 10 });
  });

  it('maps backend items/total to ProTable data/total', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: {
        items: [{ id: 7 }],
        total: 42,
        page_no: 1,
        page_size: 10,
        has_next: true,
      },
      status_code: 200,
      success: true,
    });

    const result = await toProTableRequest(api)({});

    expect(result.data).toEqual([{ id: 7 }]);
    expect(result.total).toBe(42);
    expect(result.success).toBe(true);
  });

  it('tolerates a null data payload', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: null,
      status_code: 200,
      success: true,
    });

    const result = await toProTableRequest(api)({});

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('passes through extra search params', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({ current: 1, pageSize: 10, username: 'ad' });

    expect(api).toHaveBeenCalledWith({
      username: 'ad',
      page_no: 1,
      page_size: 10,
    });
  });

  it('clamps page_no and page_size into the range the backend accepts', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({ current: 0, pageSize: 500 });

    expect(api).toHaveBeenCalledWith({ page_no: 1, page_size: 100 });
  });

  it('drops empty search values so the backend does not reject them', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
      success: true,
    });

    await toProTableRequest(api)({
      current: 1,
      pageSize: 10,
      username: '',
      mobile: undefined,
      name: 'ad',
    });

    expect(api).toHaveBeenCalledWith({ name: 'ad', page_no: 1, page_size: 10 });
  });

  /**
   * 真实后端的信封里**没有 success 字段**(只有 code/msg/data/status_code)。
   *
   * 之前用 `res.success ?? false` 判成功 ⇒ 永远 false ⇒ ProTable 认为每次
   * 请求都失败 ⇒ 列表一律「暂无数据」(新建成功也看不见,像"没生效")。
   */
  it('treats a response without the success field as successful when code is 0', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 0,
      msg: '查询任务列表成功',
      data: {
        items: [{ id: 7 }],
        total: 1,
        page_no: 1,
        page_size: 10,
        has_next: false,
      },
      status_code: 200,
    });

    const result = await toProTableRequest(api)({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 7 }]);
  });

  it('treats code 200 as successful', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 200,
      msg: 'ok',
      data: { items: [], total: 0, page_no: 1, page_size: 10, has_next: false },
      status_code: 200,
    });

    const result = await toProTableRequest(api)({});

    expect(result.success).toBe(true);
  });

  it('treats a business error code as unsuccessful', async () => {
    const api = vi.fn().mockResolvedValue({
      code: 400,
      msg: '参数错误',
      data: null,
      status_code: 200,
    });

    const result = await toProTableRequest(api)({});

    expect(result.success).toBe(false);
  });
});
