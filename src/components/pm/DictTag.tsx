import { Tag } from 'antd';
import type { JSX } from 'react';
import { useDictOptions } from './useDictOptions';

/**
 * 字典驱动的状态标签 —— PM 表格里「状态 / 优先级 / 类别」列的统一渲染。
 *
 * - 颜色来自字典项的 list_class(回显样式),映射到 antd Tag 的预设色 ——
 *   状态配色由字典配置决定,前端不按枚举硬编码
 * - 选项在途时(首次拉取、或 dictType 刚切换)弱化展示原始线上码 ——
 *   行仍可读,但不冒充已定状态,也不与「查无此码」混淆(见下)
 * - 字典里查不到的值(后端新增的枚举、字典还没配)**显示原始线上码**,
 *   不显示空白 —— 宁可不是彩色的,也不能读不出来
 * - value 为空时什么都不渲染(空状态交给表格列的默认占位,不渲染空白 Tag)
 */

/** 后端 list_class → antd Tag 预设色。primary 没有同名预设,归到 processing */
const LIST_CLASS_COLOR: Record<string, string> = {
  success: 'success',
  info: 'processing',
  warning: 'warning',
  danger: 'error',
  primary: 'processing',
  default: 'default',
};

/** 字典标签的 props */
export interface DictTagProps {
  /** 字典类型编码(如 module_pm_project_status) */
  dictType: string;
  /** 线上码(dict_value);空值不渲染 */
  value?: string | null;
}

/** 字典标签:label 给人看,颜色跟字典配置走 */
export function DictTag(props: DictTagProps): JSX.Element | null {
  const { dictType, value } = props;
  const { options, loading } = useDictOptions(dictType);

  // 空值连 Tag 都不渲染(表格列有自己的空占位)
  if (value == null) return null;

  const matched = options.find((option) => option.value === value);

  // 选项在途且还查不到:弱化展示原始线上码 —— 行仍可读,但不是已定状态,
  // 也与下面「查无此码」的全强度中性 Tag 区分开
  // (共享缓存命中时这个在途窗口只有一个微任务,几乎不可见)
  if (!matched && loading) {
    return (
      <Tag color="default" style={{ opacity: 0.5 }}>
        {value}
      </Tag>
    );
  }

  // 查不到字典项:显示原始线上码 + 中性色 —— 后端新增的枚举也要能读
  if (!matched) {
    return <Tag color="default">{value}</Tag>;
  }

  // 字典配了前端不认识的回显样式时兜底成 default,不渲染坏颜色
  const color = LIST_CLASS_COLOR[matched.listClass ?? 'default'] ?? 'default';

  return <Tag color={color}>{matched.label}</Tag>;
}
