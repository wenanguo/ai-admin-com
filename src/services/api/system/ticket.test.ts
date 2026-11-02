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

  it('creates a ticket', async () => {
    await createTicket({
      title: '登录报错',
      ticket_content: '登录时后端返回 500',
      ticket_type: 'bug',
    });

    expect(request).toHaveBeenCalledWith('/system/ticket/create', {
      method: 'POST',
      data: {
        title: '登录报错',
        ticket_content: '登录时后端返回 500',
        ticket_type: 'bug',
      },
    });
  });

  it('updates a ticket by id', async () => {
    await updateTicket(7, {
      title: '登录报错',
      ticket_content: '登录时后端返回 500',
      ticket_type: 'bug',
    });

    expect(request).toHaveBeenCalledWith('/system/ticket/update/7', {
      method: 'PUT',
      data: {
        title: '登录报错',
        ticket_content: '登录时后端返回 500',
        ticket_type: 'bug',
      },
    });
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
