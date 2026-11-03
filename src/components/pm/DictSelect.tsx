import { Select } from 'antd';
import type { JSX } from 'react';
import { useDictOptions } from './useDictOptions';

/**
 * 字典驱动的下拉选择器 —— PM 表单里「状态 / 类型 / 类别」字段的统一控件。
 *
 * 本体是普通 antd Select 的受控封装,两条使用路径:
 * 1. 直接放进 `ProForm.Item`(ModalForm 的表单项)—— value/onChange 就是标准受控协议
 * 2. ProFormSelect 不认自定义组件字段,走 `toProSelectRequest(dictType)`
 *    喂它的 `request`(见 useDictOptions.ts)
 *
 * 受控契约:value 与 onChange 都是**线上码(dict_value)** ——
 * 「进行中」只是给人看的,提交给后端的永远是 in_progress。
 */

/** 字典下拉的 props */
export interface DictSelectProps {
  /** 字典类型编码(如 module_pm_project_status) */
  dictType: string;
  /** 选中的线上码(dict_value) */
  value?: string;
  /** 选中变化;清空时回传 undefined */
  onChange?: (v?: string) => void;
  placeholder?: string;
  allowClear?: boolean;
}

/** 字典下拉:选项来自字典接口,label 给人看、value 给后端 */
export function DictSelect(props: DictSelectProps): JSX.Element {
  const {
    dictType,
    value,
    onChange,
    placeholder = '请选择',
    allowClear = true,
  } = props;
  const { options, loading } = useDictOptions(dictType);

  return (
    <Select<string>
      style={{ width: '100%' }}
      value={value}
      // 包一层:对外的契约是「只回传线上码」,
      // 不透传 antd 的第二个参数(整个 option 对象)
      onChange={(next) => onChange?.(next)}
      placeholder={placeholder}
      allowClear={allowClear}
      loading={loading}
      options={options}
    />
  );
}
