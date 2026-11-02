import type { ProColumns } from '@ant-design/pro-components';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook } from 'vitest-browser-react';
import { CRUD_PAGINATION, useCrudColumns, useCrudTable } from './index';

/**
 * 共享 CRUD 脚手架的单测。
 *
 * 覆盖三件被规格 §5.3 钉死的事:
 * 1. 操作列的按钮按权限码门控(权限码写错会静默禁用按钮,是最难发现的一类 bug)
 * 2. 删除走 remove([id])
 * 3. 提交按有没有 editing 记录走 create / update
 */

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn<(code: string) => boolean>(),
}));

vi.mock('@umijs/max', () => ({
  useAccess: () => ({ hasPermission: mocks.hasPermission }),
}));

type DemoRecord = { id?: number | null; name?: string | null };
type DemoValues = { name: string };

const EDIT_PERM = 'module_system:position:update';
const DELETE_PERM = 'module_system:position:delete';

/** 把 ProColumns 的 render 抽出来直接渲染,避免为了测一列而挂一整张 ProTable */
function renderColumn(
  column: ProColumns<DemoRecord>,
  record: DemoRecord,
): React.ReactNode {
  const render = column.render as unknown as (
    dom: React.ReactNode,
    entity: DemoRecord,
    index: number,
    action: unknown,
    schema: unknown,
  ) => React.ReactNode;
  return render(null, record, 0, undefined, undefined);
}

const OptionColumn: React.FC<{ record: DemoRecord }> = ({ record }) => {
  const columns = useCrudColumns<DemoRecord>({
    onEdit: () => {},
    onDelete: () => {},
    editPerm: EDIT_PERM,
    deletePerm: DELETE_PERM,
    entityName: '岗位',
  });
  return <div>{renderColumn(columns[0], record)}</div>;
};

function createHarness() {
  const create = vi.fn<(values: DemoValues) => Promise<unknown>>();
  const update = vi.fn<(id: number, values: DemoValues) => Promise<unknown>>();
  const remove = vi.fn<(ids: number[]) => Promise<unknown>>();
  return { create, update, remove };
}

describe('CrudTable 共享脚手架', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('权限码不足时编辑与删除按钮都 disabled', async () => {
    mocks.hasPermission.mockReturnValue(false);

    const { getByRole } = await render(
      <OptionColumn record={{ id: 1, name: '后端工程师' }} />,
    );

    await expect.element(getByRole('button', { name: '编辑' })).toBeDisabled();
    await expect.element(getByRole('button', { name: '删除' })).toBeDisabled();
  });

  it('权限码齐全时编辑与删除按钮都 enabled,并按传入的权限码判定', async () => {
    mocks.hasPermission.mockImplementation(
      (code: string) => code === EDIT_PERM || code === DELETE_PERM,
    );

    const { getByRole } = await render(
      <OptionColumn record={{ id: 1, name: '后端工程师' }} />,
    );

    await expect.element(getByRole('button', { name: '编辑' })).toBeEnabled();
    await expect.element(getByRole('button', { name: '删除' })).toBeEnabled();
    expect(mocks.hasPermission).toHaveBeenCalledWith(EDIT_PERM);
    expect(mocks.hasPermission).toHaveBeenCalledWith(DELETE_PERM);
  });

  it('删除时调用 remove([record.id])', async () => {
    const { create, update, remove } = createHarness();
    remove.mockResolvedValue(undefined);

    const { result, act } = await renderHook(() =>
      useCrudTable<DemoRecord, DemoValues>({ create, update, remove }),
    );

    await act(async () => {
      await result.current.handleDelete({ id: 7, name: '后端工程师' });
    });

    expect(remove).toHaveBeenCalledWith([7]);
  });

  it('删除失败时吞掉异常(提示由请求层统一弹)', async () => {
    const { create, update, remove } = createHarness();
    remove.mockRejectedValue(new Error('boom'));

    const { result, act } = await renderHook(() =>
      useCrudTable<DemoRecord, DemoValues>({ create, update, remove }),
    );

    await act(async () => {
      await expect(
        result.current.handleDelete({ id: 7, name: '后端工程师' }),
      ).resolves.toBeUndefined();
    });
  });

  it('没有编辑记录时提交走 create', async () => {
    const { create, update, remove } = createHarness();
    create.mockResolvedValue(undefined);

    const { result, act } = await renderHook(() =>
      useCrudTable<DemoRecord, DemoValues>({ create, update, remove }),
    );

    let submitted = false;
    await act(async () => {
      submitted = await result.current.handleSubmit({ name: '后端工程师' });
    });

    expect(submitted).toBe(true);
    expect(create).toHaveBeenCalledWith({ name: '后端工程师' });
    expect(update).not.toHaveBeenCalled();
  });

  it('有编辑记录时提交走 update(id, values)', async () => {
    const { create, update, remove } = createHarness();
    update.mockResolvedValue(undefined);

    const { result, act } = await renderHook(() =>
      useCrudTable<DemoRecord, DemoValues>({ create, update, remove }),
    );

    await act(async () => {
      result.current.openEdit({ id: 7, name: '后端工程师' });
    });
    expect(result.current.editing?.id).toBe(7);
    expect(result.current.modalOpen).toBe(true);

    let submitted = false;
    await act(async () => {
      submitted = await result.current.handleSubmit({ name: '前端工程师' });
    });

    expect(submitted).toBe(true);
    expect(update).toHaveBeenCalledWith(7, { name: '前端工程师' });
    expect(create).not.toHaveBeenCalled();
  });

  it('提交失败时返回 false(弹窗不关闭)', async () => {
    const { create, update, remove } = createHarness();
    create.mockRejectedValue(new Error('boom'));

    const { result, act } = await renderHook(() =>
      useCrudTable<DemoRecord, DemoValues>({ create, update, remove }),
    );

    let submitted = true;
    await act(async () => {
      submitted = await result.current.handleSubmit({ name: '后端工程师' });
    });

    expect(submitted).toBe(false);
  });

  it('openCreate 清空编辑对象并打开弹窗', async () => {
    const { create, update, remove } = createHarness();

    const { result, act } = await renderHook(() =>
      useCrudTable<DemoRecord, DemoValues>({ create, update, remove }),
    );

    await act(async () => {
      result.current.openEdit({ id: 7, name: '后端工程师' });
    });
    await act(async () => {
      result.current.openCreate();
    });

    expect(result.current.editing).toBeUndefined();
    expect(result.current.modalOpen).toBe(true);
  });

  it('分页常量的 pageSizeOptions 上限是 100(后端约束)', () => {
    expect(CRUD_PAGINATION).toEqual({
      defaultPageSize: 10,
      pageSizeOptions: [10, 20, 50, 100],
      showSizeChanger: true,
    });
  });
});
