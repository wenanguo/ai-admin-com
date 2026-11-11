import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-react';
import type { UserCreateParams } from '@/services/api/system/types';
import UserModalForm from './ModalForm';

/**
 * 用户表单的部门字段。
 *
 * 钉住本轮唯一一处**已上线页面**的改动:
 * 「部门」从「部门 ID」数字框换成了部门树选择器,
 * 提交的字段仍然是 `dept_id`,而且必须是**数字**(后端契约是 number)。
 *
 * 组件是真的:树选择器用真的 DeptTreeSelect,只把两个 service 换成假数据。
 */

const mocks = vi.hoisted(() => ({
  getDeptTree: vi.fn(),
  listRoles: vi.fn(),
}));

vi.mock('@/services/api/system/dept', () => ({
  getDeptTree: mocks.getDeptTree,
}));

vi.mock('@/services/api/system/role', () => ({
  listRoles: mocks.listRoles,
}));

/** 造一个成功信封 */
function envelope(data: unknown) {
  return {
    code: 0,
    msg: 'ok',
    data,
    status_code: 200,
    success: true,
  };
}

/** 两级部门树:总公司 → 研发部(要选的是 id=2 的「研发部」) */
const deptTree = [
  {
    id: 1,
    name: '总公司',
    code: 'hq',
    children: [{ id: 2, name: '研发部', code: 'rd', children: [] }],
  },
];

/**
 * 部门树选择器的输入框。
 *
 * 弹窗里有三个 combobox(部门树 / 角色 / 状态),靠位置区分太脆;
 * 这里从「部门」这一项的表单项里取 —— 那一项里只有树选择器。
 */
function deptTreeSelectInput(label: { element: () => Element }) {
  const formItem = label.element().closest('.ant-form-item');
  const input = formItem?.querySelector('input[role="combobox"]');
  if (!input) throw new Error('找不到部门树选择器的输入框');
  return input;
}

describe('用户表单的部门字段', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDeptTree.mockResolvedValue(envelope(deptTree));
    mocks.listRoles.mockResolvedValue(
      envelope({
        items: [],
        total: 0,
        page_no: 1,
        page_size: 100,
        has_next: false,
      }),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('通过部门树选择器提交 dept_id(number)', async () => {
    const onSubmit = vi.fn(async (_values: UserCreateParams) => true);

    const { getByLabelText, getByRole, getByText } = await render(
      <UserModalForm open onOpenChange={() => {}} onSubmit={onSubmit} />,
    );

    // 部门树请求回来了
    await vi.waitFor(() => {
      expect(mocks.getDeptTree).toHaveBeenCalled();
    });

    // 部门字段是**树选择器**(占位符是「请选择部门」,不是数字框)
    const deptSelect = page.elementLocator(
      deptTreeSelectInput(getByText('部门')),
    );
    await deptSelect.click();

    // 选「研发部」(id=2)
    await getByText('研发部').click();

    // 必填项填上(不然表单校验过不去,onFinish 不会触发)
    await getByLabelText('用户名').fill('zhangsan');
    await getByLabelText('密码').fill('Passw0rd!');

    // 提交(antd 会在两个汉字之间插空格 ⇒ 「确 认」)
    await getByRole('button', { name: /确\s*认/ }).click();

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    const values = onSubmit.mock.calls[0][0];

    // 提交的是**部门 id 的数字**,不是 label 也不是字符串
    expect(values.dept_id).toBe(2);
    expect(typeof values.dept_id).toBe('number');
  });
});
