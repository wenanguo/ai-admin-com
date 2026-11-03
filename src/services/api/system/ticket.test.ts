import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchUpdateTickets,
  createTicket,
  deleteTickets,
  getTicketDetail,
  listTickets,
  updateTicket,
} from './ticket';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system ticket service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: null,
      status_code: 200,
      success: true,
    });
  });

  it('lists tickets with pagination params', async () => {
    await listTickets({ page_no: 1, page_size: 10, title: '登录' });

    expect(request).toHaveBeenCalledWith('/system/ticket/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, title: '登录' },
    });
  });

  it('gets a ticket detail by id', async () => {
    await getTicketDetail(7);

    expect(request).toHaveBeenCalledWith('/system/ticket/detail/7', {
      method: 'GET',
    });
  });

  // 创建走 TicketCreateSchema(description ≤255):**没有** reply 字段 ——
  // 之前把 reply 混进创建入参,pydantic 默认 extra='ignore' 把它静默丢弃,
  // 新写的回复永远存不进去
  it('creates a ticket with description, not reply', async () => {
    await createTicket({
      title: '登录报错',
      ticket_content: '登录时后端返回 500',
      ticket_type: 'bug',
      description: '客户环境必现',
    });

    expect(request).toHaveBeenCalledWith('/system/ticket/create', {
      method: 'POST',
      data: {
        title: '登录报错',
        ticket_content: '登录时后端返回 500',
        ticket_type: 'bug',
        description: '客户环境必现',
      },
    });
    // 与下面的更新用例互为镜像:创建请求体**不允许**出现 reply
    expect(request).toHaveBeenCalledWith(
      '/system/ticket/create',
      expect.objectContaining({
        data: expect.not.objectContaining({ reply: expect.anything() }),
      }),
    );
  });

  // 更新走 TicketUpdateSchema(有 reply / status / assigned_id):与创建相反,
  // 带 reply、不带 description / images —— 提交了对方 schema 没有的字段,
  // 一样会被静默丢弃
  it('updates a ticket with reply, not description or images', async () => {
    await updateTicket(7, {
      title: '登录报错(已定位)',
      reply: '是网关的证书过期,已修复',
    });

    expect(request).toHaveBeenCalledWith('/system/ticket/update/7', {
      method: 'PUT',
      data: {
        title: '登录报错(已定位)',
        reply: '是网关的证书过期,已修复',
      },
    });
    // 与上面的创建用例互为镜像:更新请求体**不允许**出现 description / images
    expect(request).toHaveBeenCalledWith(
      '/system/ticket/update/7',
      expect.objectContaining({
        data: expect.not.objectContaining({
          description: expect.anything(),
          images: expect.anything(),
        }),
      }),
    );
  });

  it('deletes tickets by a bare id array', async () => {
    await deleteTickets([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/ticket/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  // 批量更新是「批量改状态」,不是通用的「批量改任意字段」:
  // 后端 TicketBatchSchema 的字段就是 { ids, status },方法是 PUT(不是 PATCH)
  it('batch updates ticket status with PUT', async () => {
    await batchUpdateTickets({ ids: [1, 2], status: 2 });

    expect(request).toHaveBeenCalledWith('/system/ticket/batch', {
      method: 'PUT',
      data: { ids: [1, 2], status: 2 },
    });
  });
});
