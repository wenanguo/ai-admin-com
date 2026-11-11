import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import DeptTreeSelect from './index';

/**
 * 部门树选择器的单测。
 *
 * 钉住五件事:
 * - RF5:空树 / 单节点时正常渲染、不抛异常(后端的树可能只有一棵,甚至一棵都没有)
 * - 树形结构:父子两级的标题都渲染成选项
 * - `excludeId`:被排除的节点**连同它的整棵子树**都不出现(选父部门时防自引用)
 * - 选中后 `onChange` 回传部门 id(用户表单靠它提交 dept_id)
 * - 拉树**不走全局错误处理**:权限不足时安静降级(空下拉 + 行内提示),
 *   不弹全局 toast
 */

const mocks = vi.hoisted(() => ({
  getDeptTree: vi.fn(),
}));

vi.mock('@/services/api/system/dept', () => ({
  getDeptTree: mocks.getDeptTree,
}));

/** 造一个成功信封 */
function envelope(data: unknown) {
  return {
    code: 0,
    msg: '查询部门树成功',
    data,
    status_code: 200,
    success: true,
  };
}

/** 两级部门树:总公司 → 研发部 */
const twoLevelTree = [
  {
    id: 1,
    name: '总公司',
    code: 'hq',
    children: [{ id: 2, name: '研发部', code: 'rd', children: [] }],
  },
];

/**
 * 多选的受控用法:选中的值要回传给组件,否则选完会被重置。
 *
 * (定义在模块层 —— 组件定义在函数体内会让 React 每次渲染都当成新组件)
 */
function MultipleSelect({ onChange }: { onChange: (value: number[]) => void }) {
  const [value, setValue] = useState<number[]>([]);
  return (
    <DeptTreeSelect
      multiple
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

/** 等部门树请求发出(组件在挂载时拉一次) */
async function waitForTreeLoaded() {
  await vi.waitFor(() => {
    expect(mocks.getDeptTree).toHaveBeenCalled();
  });
}

describe('DeptTreeSelect 部门树选择器', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDeptTree.mockResolvedValue(envelope([]));
  });

  afterEach(async () => {
    await cleanup();
  });

  it('空树时正常渲染,下拉里没有任何选项(RF5)', async () => {
    mocks.getDeptTree.mockResolvedValue(envelope([]));

    const { getByRole } = await render(<DeptTreeSelect />);
    await waitForTreeLoaded();

    // 选择框在
    await expect.element(getByRole('combobox')).toBeInTheDocument();

    // 打开下拉:没有选项(树是空的,不是异常)
    await getByRole('combobox').click();
    expect(getByRole('treeitem').elements()).toHaveLength(0);
  });

  it('只有一个节点时正常渲染(RF5)', async () => {
    mocks.getDeptTree.mockResolvedValue(
      envelope([{ id: 1, name: '总公司', code: 'hq' }]),
    );

    const { getByRole, getByText } = await render(<DeptTreeSelect />);
    await waitForTreeLoaded();

    await expect.element(getByRole('combobox')).toBeInTheDocument();

    await getByRole('combobox').click();
    await expect.element(getByText('总公司')).toBeVisible();
  });

  it('父子两级的部门都渲染成选项', async () => {
    mocks.getDeptTree.mockResolvedValue(envelope(twoLevelTree));

    const { getByRole, getByText } = await render(<DeptTreeSelect />);
    await waitForTreeLoaded();

    await getByRole('combobox').click();

    await expect.element(getByText('总公司')).toBeVisible();
    await expect.element(getByText('研发部')).toBeVisible();
  });

  it('excludeId 的节点连同它的整棵子树都不出现', async () => {
    mocks.getDeptTree.mockResolvedValue(envelope(twoLevelTree));

    const { getByRole, getByText } = await render(
      <DeptTreeSelect excludeId={1} />,
    );
    await waitForTreeLoaded();

    await getByRole('combobox').click();

    // 被排除的节点自己没了
    await expect.element(getByText('总公司')).not.toBeInTheDocument();
    // 它的子树也没了
    await expect.element(getByText('研发部')).not.toBeInTheDocument();
  });

  it('选中部门后 onChange 回传部门 id', async () => {
    mocks.getDeptTree.mockResolvedValue(envelope(twoLevelTree));
    const onChange = vi.fn();

    const { getByRole, getByText } = await render(
      <DeptTreeSelect onChange={onChange} />,
    );
    await waitForTreeLoaded();

    await getByRole('combobox').click();
    await getByText('研发部').click();

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(2);
    });
  });

  it('多选模式:可以选多个部门,onChange 回传 id 数组', async () => {
    mocks.getDeptTree.mockResolvedValue(envelope(twoLevelTree));
    const onChange = vi.fn();

    const { getByRole, getByText } = await render(
      <MultipleSelect onChange={onChange} />,
    );
    await waitForTreeLoaded();

    await getByRole('combobox').click();
    await getByText('总公司').click();
    // 多选模式下拉不会关闭,可以直接再选一个
    await getByText('研发部').click();

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([1, 2]);
    });
  });

  it('拉部门树不走全局错误处理(权限不足不该弹全局 toast)', async () => {
    mocks.getDeptTree.mockResolvedValue(envelope([]));

    const { getByRole } = await render(<DeptTreeSelect />);
    await waitForTreeLoaded();

    // 组件自己处理失败 ⇒ 请求层不要再弹一次 toast
    expect(mocks.getDeptTree).toHaveBeenCalledWith({
      skipErrorHandler: true,
    });
    await expect.element(getByRole('combobox')).toBeInTheDocument();
  });

  it('没有部门权限时安静降级:空下拉 + 行内提示', async () => {
    // 请求层把后端的业务信封转成 BizError(信封在 error.info 里)
    mocks.getDeptTree.mockRejectedValue({
      name: 'BizError',
      info: { code: 403, msg: '无权限访问', data: null },
    });

    const { getByRole, getByText } = await render(<DeptTreeSelect />);
    await waitForTreeLoaded();

    // 选择器还在(表单还能用),只是没有选项
    await expect.element(getByRole('combobox')).toBeInTheDocument();
    await getByRole('combobox').click();
    expect(getByRole('treeitem').elements()).toHaveLength(0);

    // 行内提示说明原因(不是全局 toast)
    await expect
      .element(getByText('没有查看部门的权限,无法选择部门'))
      .toBeVisible();
  });

  it('其它失败也降级成行内提示(不抛异常)', async () => {
    mocks.getDeptTree.mockRejectedValue(new Error('network down'));

    const { getByRole, getByText } = await render(<DeptTreeSelect />);
    await waitForTreeLoaded();

    await expect.element(getByRole('combobox')).toBeInTheDocument();
    await expect
      .element(getByText('部门列表加载失败,请稍后重试'))
      .toBeVisible();
  });
});
