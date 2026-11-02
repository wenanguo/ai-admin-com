import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import DeptTreeSelect from './index';

/**
 * 部门树选择器的单测。
 *
 * 钉住四件事:
 * - RF5:空树 / 单节点时正常渲染、不抛异常(后端的树可能只有一棵,甚至一棵都没有)
 * - 树形结构:父子两级的标题都渲染成选项
 * - `excludeId`:被排除的节点**连同它的整棵子树**都不出现(选上级部门时防自引用)
 * - 选中后 `onChange` 回传部门 id(用户表单靠它提交 dept_id)
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
});
