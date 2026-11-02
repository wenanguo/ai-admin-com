import type { ActionType, ProColumns } from '@ant-design/pro-components';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook } from 'vitest-browser-react';
import {
  CRUD_PAGINATION,
  type CrudColumnOptions,
  useCrudColumns,
  useCrudTable,
  useDeleteHandler,
} from './index';

/**
 * 共享 CRUD 脚手架的单测。
 *
 * 覆盖五件被规格 §5.3 钉死的事:
 * 1. 操作列的按钮按权限码门控(权限码写错会静默禁用按钮,是最难发现的一类 bug)
 * 2. 只读形态(两个编辑参数都不给)不渲染「编辑」按钮(只读页走同一份实现)
 * 3. 删除走 remove([id])
 * 4. 提交按有没有 editing 记录走 create / update
 * 5. 类型层:`onEdit` 与 `editPerm` 必须成对出现、`useDeleteHandler` 的 actionRef 必填
 *    —— 这两条用 `@ts-expect-error` 断言,由 `tsc --noEmit`(npm run lint)把守
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

/** 只读页的操作列:onEdit / editPerm 都不给 ⇒ 只有「删除」按钮 */
const ReadOnlyOptionColumn: React.FC<{ record: DemoRecord }> = ({ record }) => {
  const columns = useCrudColumns<DemoRecord>({
    onDelete: () => {},
    deletePerm: DELETE_PERM,
    entityName: '日志',
  });
  return <div>{renderColumn(columns[0], record)}</div>;
};

/**
 * 类型层断言:`onEdit` 与 `editPerm` 必须**成对**出现。
 *
 * 这几个 `const` 的类型由 tsc 把关(不是运行时断言):
 * - 前两个带 `@ts-expect-error` ⇒ 只给一个必须**编译报错**
 * - 一旦类型放松(可选属性),tsc 会报「Unused '@ts-expect-error' directive」
 *   ⇒ `npm run lint` 立刻变红,保证不会退回「静默少一个按钮」
 */
function columnOptionTypeAssertions(): CrudColumnOptions<DemoRecord>[] {
  // @ts-expect-error 少了 editPerm ⇒ 编译期必须报错
  const missingEditPerm: CrudColumnOptions<DemoRecord> = {
    onEdit: () => {},
    onDelete: () => {},
    deletePerm: DELETE_PERM,
    entityName: '岗位',
  };
  // @ts-expect-error 少了 onEdit ⇒ 编译期必须报错
  const missingOnEdit: CrudColumnOptions<DemoRecord> = {
    onDelete: () => {},
    editPerm: EDIT_PERM,
    deletePerm: DELETE_PERM,
    entityName: '岗位',
  };
  // 两个都给 ⇒ 合法(有编辑入口)
  const both: CrudColumnOptions<DemoRecord> = {
    onEdit: () => {},
    onDelete: () => {},
    editPerm: EDIT_PERM,
    deletePerm: DELETE_PERM,
    entityName: '岗位',
  };
  // 两个都不给 ⇒ 合法(只读形态)
  const readOnly: CrudColumnOptions<DemoRecord> = {
    onDelete: () => {},
    deletePerm: DELETE_PERM,
    entityName: '日志',
  };
  return [missingEditPerm, missingOnEdit, both, readOnly];
}

/** 造一个只关心 reload 的 actionRef(ActionType 有几十个成员,测试里用窄替身) */
function createActionRef(
  reload: () => void = () => {},
): React.RefObject<ActionType | undefined> {
  return {
    current: { reload },
  } as unknown as React.RefObject<ActionType | undefined>;
}

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

  it('只读形态(两个编辑参数都不给)不渲染「编辑」按钮,只有「删除」', async () => {
    mocks.hasPermission.mockImplementation(
      (code: string) => code === DELETE_PERM,
    );

    const { getByRole } = await render(
      <ReadOnlyOptionColumn record={{ id: 1, name: '后端工程师' }} />,
    );

    // 只有删除按钮 —— 只读页不该出现编辑入口
    await expect
      .element(getByRole('button', { name: '编辑' }))
      .not.toBeInTheDocument();
    await expect.element(getByRole('button', { name: '删除' })).toBeEnabled();
  });

  it('onEdit 与 editPerm 必须成对出现(类型层断言,tsc 把关)', () => {
    // 真正把关的是 tsc --noEmit:只给一个 ⇒ 编译报错;
    // 类型一旦放松,tsc 会报「Unused '@ts-expect-error' directive」
    expect(columnOptionTypeAssertions()).toHaveLength(4);
  });

  it('useDeleteHandler 删除时调用 remove([record.id])', async () => {
    const remove = vi.fn<(ids: number[]) => Promise<unknown>>();
    remove.mockResolvedValue(undefined);

    const { result, act } = await renderHook(() =>
      useDeleteHandler<DemoRecord>(remove, createActionRef()),
    );

    await act(async () => {
      await result.current({ id: 7, name: '后端工程师' });
    });

    expect(remove).toHaveBeenCalledWith([7]);
  });

  it('useDeleteHandler 删除成功后刷新列表,失败时吞掉异常', async () => {
    const reload = vi.fn();
    const actionRef = createActionRef(reload);

    const remove = vi.fn<(ids: number[]) => Promise<unknown>>();
    remove.mockResolvedValue(undefined);

    const { result, act } = await renderHook(() =>
      useDeleteHandler<DemoRecord>(remove, actionRef),
    );

    await act(async () => {
      await result.current({ id: 7, name: '后端工程师' });
    });

    expect(reload).toHaveBeenCalledTimes(1);

    // 失败:异常被吞掉(提示由请求层统一弹)
    const failing = vi.fn<(ids: number[]) => Promise<unknown>>();
    failing.mockRejectedValue(new Error('boom'));
    const { result: failedResult, act: failedAct } = await renderHook(() =>
      useDeleteHandler<DemoRecord>(failing, actionRef),
    );

    await failedAct(async () => {
      await expect(
        failedResult.current({ id: 7, name: '后端工程师' }),
      ).resolves.toBeUndefined();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('useDeleteHandler 少传 actionRef 编译不过(不会静默退化成「删完不刷新」)', async () => {
    const { result } = await renderHook(() =>
      // @ts-expect-error actionRef 必填:少传就是编译错误 —— 类型放松了这条指令就会「用不上」
      useDeleteHandler<DemoRecord>(() => Promise.resolve()),
    );

    expect(result.current).toBeTypeOf('function');
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
