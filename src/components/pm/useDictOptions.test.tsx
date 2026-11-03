import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook } from 'vitest-browser-react';
import { DictSelect } from './DictSelect';
import { DictTag } from './DictTag';
import {
  clearDictOptionsCache,
  toProSelectRequest,
  useDictOptions,
} from './useDictOptions';

/**
 * 字典驱动选项族(hook / toProSelectRequest / DictSelect / DictTag)的单测。
 *
 * 钉死五件事:
 * 1. 选项的 value 是后端的 **dict_value(线上码)**,label 才是 dict_label(显示文本)
 *    —— 表单提交的是线上码,把「进行中」提交上去就是 422
 * 2. list_class 随选项带出:DictTag 靠它映射 antd 预设色,
 *    状态配色由字典配置决定,前端不按枚举硬编码
 * 3. 字典接口挂掉时降级成空选项 + console.warn,**不抛** ——
 *    页面不能因为一个字典端点挂了就白屏
 * 4. 字典里查不到的值显示原始线上码(后端新增的枚举也要能读),不显示空白
 * 5. 同一字典类型的请求全模块只发一次(共享缓存):并发挂载去重、
 *    落地后不再发、失败不毒化缓存(下次挂载可重试)
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

/** dictType 切换用例的第二个字典类型:风险等级 */
const DICT_TYPE_B = 'module_pm_risk_level';

/** dictType 切换用例的第二个字典:一项,与项目状态字典的内容完全不同 */
const RISK_LEVEL_DICT = [
  {
    dict_label: '高风险',
    dict_value: 'high',
    dict_type: DICT_TYPE_B,
    list_class: 'danger',
  },
];

/** 并发挂载用例的五行字典:五个线上码、五个互不重复的 label(断言定位用) */
const ROW_STATUS_DICT = [
  { dict_label: '进行中', dict_value: 'in_progress' },
  { dict_label: '已暂停', dict_value: 'paused' },
  { dict_label: '已完成', dict_value: 'done' },
  { dict_label: '已挂起', dict_value: 'blocked' },
  { dict_label: '已取消', dict_value: 'cancelled' },
];

describe('字典驱动的选项与状态标签', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 模块级缓存是跨用例共享的:每个用例从空缓存起步,互不喂料
    clearDictOptionsCache();
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

    it('dictType 变化时先清空旧字典的选项,新字典在途期间不残留', async () => {
      // 第一个字典立即可用;第二个字典挂起,制造可观察的「新字典在途」窗口
      let resolveDictB: (value: unknown) => void = () => {};
      mocks.getDictDataByType.mockImplementation((type: string) => {
        if (type === DICT_TYPE_B) {
          return new Promise((resolve) => {
            resolveDictB = resolve;
          });
        }
        return Promise.resolve(envelope(PROJECT_STATUS));
      });

      const { result, rerender } = await renderHook((type?: string) =>
        useDictOptions(type ?? DICT_TYPE),
      );

      // 旧字典就位
      await vi.waitFor(() => {
        expect(result.current.options).toHaveLength(2);
      });
      expect(result.current.options[0].value).toBe('in_progress');

      // 换字典:新请求在途,旧字典的选项必须已清空 ——
      // 不能让上一个字典的值还挂在下拉里可选
      await rerender(DICT_TYPE_B);
      await vi.waitFor(() => {
        expect(result.current.options).toEqual([]);
        expect(result.current.loading).toBe(true);
      });

      resolveDictB(envelope(RISK_LEVEL_DICT));
      await vi.waitFor(() => {
        expect(result.current.options).toHaveLength(1);
      });
      expect(result.current.options[0].value).toBe('high');
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

  describe('字典请求的模块级共享缓存', () => {
    it('同一字典的多个标签并发挂载只发一次请求(表格 20 行不能变成 20 个请求)', async () => {
      mocks.getDictDataByType.mockResolvedValue(envelope(ROW_STATUS_DICT));

      const { getByText } = await render(
        <div>
          {ROW_STATUS_DICT.map((item) => (
            <DictTag
              key={item.dict_value}
              dictType={DICT_TYPE}
              value={item.dict_value}
            />
          ))}
        </div>,
      );

      // 五行标签全部出结果(选项就位)
      for (const item of ROW_STATUS_DICT) {
        await expect.element(getByText(item.dict_label)).toBeVisible();
      }

      // 五个标签、同一个字典类型:整个页面生命周期内只允许一次请求
      expect(mocks.getDictDataByType).toHaveBeenCalledTimes(1);
      expect(mocks.getDictDataByType).toHaveBeenCalledWith(DICT_TYPE);
    });

    it('首次请求落地后,再次挂载与 toProSelectRequest 共享缓存,不再发请求', async () => {
      const first = await renderHook(() => useDictOptions(DICT_TYPE));
      await vi.waitFor(() => {
        expect(first.result.current.options).toHaveLength(2);
      });
      expect(mocks.getDictDataByType).toHaveBeenCalledTimes(1);

      // 第二次挂载同一个字典类型:缓存命中,不重发
      const second = await renderHook(() => useDictOptions(DICT_TYPE));
      await vi.waitFor(() => {
        expect(second.result.current.options).toHaveLength(2);
      });
      expect(mocks.getDictDataByType).toHaveBeenCalledTimes(1);

      // toProSelectRequest 与 hook 共用同一份缓存,也不重发
      const options = await toProSelectRequest(DICT_TYPE)();
      expect(options).toHaveLength(2);
      expect(options[0].value).toBe('in_progress');
      expect(mocks.getDictDataByType).toHaveBeenCalledTimes(1);
    });

    it('失败的字典请求不进缓存:再次挂载会重试', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mocks.getDictDataByType.mockRejectedValue(new Error('network down'));

      try {
        // 第一次:失败,降级成空选项
        const failed = await renderHook(() => useDictOptions(DICT_TYPE));
        await vi.waitFor(() => {
          expect(failed.result.current.loading).toBe(false);
        });
        expect(failed.result.current.options).toEqual([]);
        expect(mocks.getDictDataByType).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);

        // 第二次:失败被逐出缓存,允许重试;这次网络恢复,选项就位
        mocks.getDictDataByType.mockResolvedValue(envelope(PROJECT_STATUS));
        const retried = await renderHook(() => useDictOptions(DICT_TYPE));
        await vi.waitFor(() => {
          expect(retried.result.current.options).toHaveLength(2);
        });
        expect(mocks.getDictDataByType).toHaveBeenCalledTimes(2);
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

    it('选项在途时弱化展示原始线上码,加载完成后恢复全强度(不与「查无此码」混淆)', async () => {
      // 请求挂起,制造可观察的「选项在途」窗口
      let resolveFetch: (value: unknown) => void = () => {};
      mocks.getDictDataByType.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const { getByText } = await render(
        <DictTag dictType={DICT_TYPE} value="in_progress" />,
      );

      // 在途:原始码仍可读(行不空),但样式是弱化的,不冒充已定状态
      await expect.element(getByText('in_progress')).toBeVisible();
      const inFlight = getByText('in_progress').elements()[0];
      expect(inFlight.className).toContain('ant-tag');
      expect(inFlight.style.opacity).toBe('0.5');

      // 加载完成:显示字典 label,恢复全强度
      resolveFetch(envelope(PROJECT_STATUS));
      await expect.element(getByText('进行中')).toBeVisible();
      const settled = getByText('进行中').elements()[0];
      expect(settled.style.opacity).toBe('');
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
