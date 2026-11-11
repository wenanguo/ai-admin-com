import { useEffect, useState } from 'react';
import type { DictDataOut } from '@/services/api/system/dict';
import { getDictDataByType } from '@/services/api/system/dict';

/**
 * 字典驱动的选项源 —— PM 各页的「状态 / 类型 / 类别」下拉与标签共用。
 *
 * 三条硬规则:
 * 1. 选项的 value 是后端的 **dict_value(线上码)**,label 才是 dict_label(显示文本)。
 *    表单提交的是线上码 —— 把「进行中」提交上去就是 422,这是本文件最重要的一条。
 * 2. 字典接口挂掉**不抛异常**:降级成空选项 + 一条 console.warn。
 *    页面不能因为一个字典端点挂了就白屏(下拉空着、标签显示原始码,都还可用)。
 * 3. 同一字典类型全模块只发**一次**请求:useDictOptions 与 toProSelectRequest
 *    共享模块级缓存(见 fetchDictOptions)—— 表格 20 行 DictTag 不能变成 20 个请求。
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
 * 模块级字典缓存:dictType → 选项就绪的 Promise(已 resolve 的也留在 Map 里)。
 *
 * 存 Promise 而不是值,是为了让同一 tick 并发挂载的 N 行 DictTag **共用同一个
 * in-flight 请求**;请求落地后 Promise 留在 Map 里,后续挂载直接拿到已 resolve
 * 的结果,不再发请求。字典极少变化,缓存与模块同生命周期:不设 TTL,
 * 过期逐出会把按行请求重新引进来。
 */
const dictOptionsCache = new Map<string, Promise<DictOption[]>>();

/** 清空字典缓存。单测用它做用例隔离;字典配置确认变更后的场景也可手动兜底。 */
export function clearDictOptionsCache(): void {
  dictOptionsCache.clear();
}

/**
 * 取某个字典类型的选项 —— 全模块共享的唯一请求入口。
 *
 * - 命中缓存(在途或已落地)直接返回,**不重发请求**
 * - 请求失败:逐出缓存条目、warn 一条、返回空数组 —— 失败不能毒化缓存,
 *   否则一次网络抖动会让后续挂载永远拿不到重试机会;
 *   warn 跟着请求走(一次请求一条,不按挂载数翻倍)
 */
function fetchDictOptions(dictType: string): Promise<DictOption[]> {
  const cached = dictOptionsCache.get(dictType);
  if (cached) return cached;

  const pending = getDictDataByType(dictType)
    .then((res) => toOptions(res?.data ?? []))
    .catch((error: unknown) => {
      dictOptionsCache.delete(dictType);
      warnDictFailure(dictType, error);
      return [];
    });

  dictOptionsCache.set(dictType, pending);
  return pending;
}

/**
 * 按字典类型取下拉选项。
 *
 * - 请求走模块级共享缓存(fetchDictOptions):同字典只发一次,
 *   并发挂载共用同一个在途请求
 * - 请求失败 ⇒ `{ options: [], loading: false }`,不抛(见文件头的硬规则 2)
 * - `dictType` 变化:先清空旧字典的选项再拉新的 —— 新字典在途期间,
 *   上一个字典的值不能还挂在下拉里可选;卸载/切换后的迟到响应直接丢弃(cancelled 标记)
 */
export function useDictOptions(dictType: string): DictOptionsResult {
  const [options, setOptions] = useState<DictOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOptions([]);
    setLoading(true);

    // fetchDictOptions 永不 reject(失败在内部降级成空数组),
    // 选项与 loading 在同一批状态更新里落地,没有「选项已到、loading 仍 true」的中间帧
    fetchDictOptions(dictType).then((next) => {
      if (cancelled) return;
      setOptions(next);
      setLoading(false);
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
 * `excludeValues`：**剔掉**某些线上码再给出去（如规则独占的 `at_risk`/`missed`
 * 不许人手工设，INV-13）—— 与 `DictSelect` 的同名参数同一个口径。
 *
 * 失败语义与 useDictOptions 一致:返回空数组、warn 一条、不抛 ——
 * request 一旦 reject,ProFormSelect 所在表单的渲染就挂了。
 * 与 hook 共享同一份模块级缓存:字典已被表格拉过时,这里直接命中,不再发请求。
 */
export function toProSelectRequest(
  dictType: string,
  excludeValues?: string[],
): () => Promise<{ label: string; value: string }[]> {
  return async () => {
    const options = await fetchDictOptions(dictType);
    if (!excludeValues?.length) {
      return options;
    }
    return options.filter((option) => !excludeValues.includes(option.value));
  };
}
