import { useEffect, useState } from 'react';
import type { DictDataOut } from '@/services/api/system/dict';
import { getDictDataByType } from '@/services/api/system/dict';

/**
 * 字典驱动的选项源 —— PM 各页的「状态 / 类型 / 类别」下拉与标签共用。
 *
 * 两条硬规则:
 * 1. 选项的 value 是后端的 **dict_value(线上码)**,label 才是 dict_label(显示文本)。
 *    表单提交的是线上码 —— 把「进行中」提交上去就是 422,这是本文件最重要的一条。
 * 2. 字典接口挂掉**不抛异常**:降级成空选项 + 一条 console.warn。
 *    页面不能因为一个字典端点挂了就白屏(下拉空着、标签显示原始码,都还可用)。
 *
 * list_class(回显样式)随选项带出:DictTag 靠它映射 antd 预设色,
 * 状态配色由字典配置决定,前端不按枚举硬编码。
 */

/** 下拉与标签共用的字典选项 */
export interface DictOption {
  /** 显示文本(字典的 dict_label,如「进行中」) */
  label: string;
  /** 线上码(字典的 dict_value,如 in_progress)—— 表单提交的就是它 */
  value: string;
  /** 回显样式(字典的 list_class,如 primary)—— DictTag 用它映射 antd 预设色 */
  listClass?: string | null;
}

/** useDictOptions 的返回值 */
export interface DictOptionsResult {
  /** 选项列表(未加载完或加载失败时为空数组) */
  options: DictOption[];
  /** 是否正在加载 */
  loading: boolean;
}

/**
 * 字典数据 → 选项列表。
 *
 * 缺 label 或 value 的字典项直接跳过:空选项既没法看也没法提交,
 * 与其让脏数据混进下拉,不如静默丢弃。
 */
function toOptions(items: DictDataOut[]): DictOption[] {
  const options: DictOption[] = [];
  for (const item of items) {
    if (!item.dict_label || !item.dict_value) continue;
    options.push({
      label: item.dict_label,
      value: item.dict_value,
      listClass: item.list_class,
    });
  }
  return options;
}

/** 失败的统一出口:一条 warn 留痕(供排障),调用方降级成空选项 */
function warnDictFailure(dictType: string, error: unknown): void {
  console.warn(`[pm] 字典 ${dictType} 加载失败,已降级为空选项`, error);
}

/**
 * 按字典类型取下拉选项。
 *
 * - 请求失败 ⇒ `{ options: [], loading: false }`,不抛(见文件头的硬规则 2)
 * - `dictType` 变化会重新拉取;卸载/切换后的迟到响应直接丢弃(cancelled 标记)
 */
export function useDictOptions(dictType: string): DictOptionsResult {
  const [options, setOptions] = useState<DictOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getDictDataByType(dictType)
      .then((res) => {
        if (cancelled) return;
        setOptions(toOptions(res?.data ?? []));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        warnDictFailure(dictType, error);
        setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dictType]);

  return { options, loading };
}

/**
 * 把字典包成 ProFormSelect 的 `request` 函数。
 *
 * ProFormSelect 不认自定义组件字段,它的 `request` 只吃 `{ label, value }[]`
 * —— 所以除了 `DictSelect` 的受控用法,还需要一个能直接喂给它的适配器:
 *
 * ```tsx
 * <ProFormSelect
 *   name="status_code"
 *   request={toProSelectRequest('module_pm_project_status')}
 * />
 * ```
 *
 * 失败语义与 useDictOptions 一致:返回空数组、warn 一条、不抛 ——
 * request 一旦 reject,ProFormSelect 所在表单的渲染就挂了。
 */
export function toProSelectRequest(
  dictType: string,
): () => Promise<{ label: string; value: string }[]> {
  return async () => {
    try {
      const res = await getDictDataByType(dictType);
      return toOptions(res?.data ?? []);
    } catch (error: unknown) {
      warnDictFailure(dictType, error);
      return [];
    }
  };
}
