import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook } from 'vitest-browser-react';
import { DictSelect } from './DictSelect';
import { DictTag } from './DictTag';
import { toProSelectRequest, useDictOptions } from './useDictOptions';

/**
 * 字典驱动选项族(hook / toProSelectRequest / DictSelect / DictTag)的单测。
 *
 * 钉死四件事:
 * 1. 选项的 value 是后端的 **dict_value(线上码)**,label 才是 dict_label(显示文本)
 *    —— 表单提交的是线上码,把「进行中」提交上去就是 422
 * 2. list_class 随选项带出:DictTag 靠它映射 antd 预设色,
 *    状态配色由字典配置决定,前端不按枚举硬编码
 * 3. 字典接口挂掉时降级成空选项 + console.warn,**不抛** ——
 *    页面不能因为一个字典端点挂了就白屏
 * 4. 字典里查不到的值显示原始线上码(后端新增的枚举也要能读),不显示空白
 */

const mocks = vi.hoisted(() => ({
  getDictDataByType: vi.fn(),
}));

vi.mock('@/services/api/system/dict', () => ({
  getDictDataByType: mocks.getDictDataByType,
}));

/** 项目状态字典的编码(与 project service 用的真实字典一致) */
const DICT_TYPE = 'module_pm_project_status';

/** 造一个成功信封(请求层成功时 resolve 的形态) */
function envelope(data: unknown) {
  return {
    code: 0,
    msg: '获取初始化字典数据成功',
    data,
    status_code: 200,
    success: true,
  };
}

/** 项目状态字典:两项(list_class 分别是 primary / success) */
const PROJECT_STATUS = [
  {
    id: 1,
    dict_sort: 1,
    dict_label: '进行中',
    dict_value: 'in_progress',
    dict_type: DICT_TYPE,
    list_class: 'primary',
    is_default: true,
    status: 0,
  },
  {
    id: 2,
    dict_sort: 2,
    dict_label: '已完成',
    dict_value: 'done',
    dict_type: DICT_TYPE,
    list_class: 'success',
    is_default: false,
    status: 0,
  },
];

describe('字典驱动的选项与状态标签', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认给成功信封,失败类用例自己覆写
    mocks.getDictDataByType.mockResolvedValue(envelope(PROJECT_STATUS));
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('useDictOptions', () => {
    it('选项的 value 是 dict_value(线上码),label 是 dict_label(显示文本)', async () => {
      const { result } = await renderHook(() => useDictOptions(DICT_TYPE));

      // 等请求走完(选项就位)
      await vi.waitFor(() => {
        expect(result.current.options).toHaveLength(2);
      });

      // 提交给后端的是线上码 in_progress,给人看的才是「进行中」
      expect(result.current.options[0].value).toBe('in_progress');
      expect(result.current.options[0].label).toBe('进行中');
    });

    it('选项带上 list_class(DictTag 靠它映射标签色)', async () => {
      const { result } = await renderHook(() => useDictOptions(DICT_TYPE));

      await vi.waitFor(() => {
        expect(result.current.options).toHaveLength(2);
      });

      expect(result.current.options[0].listClass).toBe('primary');
    });

    it('字典加载失败时返回空数组且不抛错(页面不能因字典白屏)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mocks.getDictDataByType.mockRejectedValue(new Error('network down'));

      try {
        // 不抛的证明:renderHook 正常返回,catch 走完之后状态回落
        const { result } = await renderHook(() => useDictOptions(DICT_TYPE));

        await vi.waitFor(() => {
          expect(warnSpy).toHaveBeenCalled();
          expect(result.current.loading).toBe(false);
        });

        expect(result.current.options).toEqual([]);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('toProSelectRequest', () => {
    it('返回 { label, value } 数组(ProFormSelect 的 request 契约),value 是线上码', async () => {
      const options = await toProSelectRequest(DICT_TYPE)();

      expect(options).toHaveLength(2);
      expect(options[0].label).toBe('进行中');
      // ProFormSelect 提交的就是这个 value —— 必须是线上码
      expect(options[0].value).toBe('in_progress');
    });

    it('失败时返回空数组且不抛(request 一抛整个表单就挂)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mocks.getDictDataByType.mockRejectedValue(new Error('network down'));

      try {
        const options = await toProSelectRequest(DICT_TYPE)();

        expect(options).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('DictSelect', () => {
    it('下拉渲染 dict_label,选中后 onChange 回传 dict_value(线上码)', async () => {
      const onChange = vi.fn();

      const { getByRole, getByText } = await render(
        <DictSelect dictType={DICT_TYPE} onChange={onChange} />,
      );

      await getByRole('combobox').click();

      // 下拉里给用户看的是显示文本
      await expect.element(getByText('已完成')).toBeVisible();
      await getByText('已完成').click();

      // 但回传给表单的是线上码 —— dict_label 只给人看
      await vi.waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('done');
      });
    });

    it('受控 value 传线上码时,选择框里显示的是字典 label', async () => {
      const { getByText } = await render(
        <DictSelect dictType={DICT_TYPE} value="in_progress" />,
      );

      // 表单里存的是 in_progress,用户看到的是「进行中」
      await expect.element(getByText('进行中')).toBeVisible();
    });
  });

  describe('DictTag', () => {
    it('六种 list_class 映射到约定的 antd 预设色,未知样式兜底 default', async () => {
      const cases = [
        {
          label: '成功',
          value: 'success',
          listClass: 'success',
          expected: 'ant-tag-success',
        },
        {
          label: '信息',
          value: 'info',
          listClass: 'info',
          expected: 'ant-tag-processing',
        },
        {
          label: '警告',
          value: 'warning',
          listClass: 'warning',
          expected: 'ant-tag-warning',
        },
        {
          label: '危险',
          value: 'danger',
          listClass: 'danger',
          expected: 'ant-tag-error',
        },
        {
          label: '主要',
          value: 'primary',
          listClass: 'primary',
          expected: 'ant-tag-processing',
        },
        {
          label: '默认',
          value: 'default',
          listClass: 'default',
          expected: 'ant-tag-default',
        },
        // 字典配了前端不认识的回显样式:兜底成 default,不能渲染坏
        {
          label: '未知样式',
          value: 'weird',
          listClass: 'fuchsia',
          expected: 'ant-tag-default',
        },
      ];
      mocks.getDictDataByType.mockResolvedValue(
        envelope(
          cases.map(({ label, value, listClass }) => ({
            dict_label: label,
            dict_value: value,
            list_class: listClass,
          })),
        ),
      );

      const { getByText } = await render(
        <div>
          {cases.map(({ value }) => (
            <DictTag key={value} dictType={DICT_TYPE} value={value} />
          ))}
        </div>,
      );

      for (const { label, expected } of cases) {
        await expect.element(getByText(label)).toBeVisible();
        // 标签色跟着字典的 list_class 走(antd 预设色类名),不是前端硬编码
        expect(getByText(label).elements()[0].className).toContain(expected);
      }
    });

    it('字典里查不到的线上码显示原始 value,不显示空白(后端新增的枚举也要能读)', async () => {
      const { getByText } = await render(
        <DictTag dictType={DICT_TYPE} value="ghost_status" />,
      );

      await expect.element(getByText('ghost_status')).toBeVisible();
    });

    it('value 为空时什么都不渲染(不渲染空白 Tag)', async () => {
      const { container } = await render(
        <DictTag dictType={DICT_TYPE} value={null} />,
      );

      // 空值连 Tag 都不该有(空状态交给表格列的默认占位)
      expect(container.querySelectorAll('.ant-tag')).toHaveLength(0);
    });
  });
});
