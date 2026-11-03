/**
 * 字典选项 → ProTable 的 `valueEnum`。
 *
 * `valueEnum` 是 ProTable 搜索下拉的配置:{ 线上码: { text: '给人看的文案' } }。
 * 字典选项的 value 是线上码(dict_value)、label 是显示文本,直接映射过来
 * 就是「搜索框里显示中文、提交给后端的是线上码」。
 *
 * ⚠️ 页面里不要再抄一份:PM 的每个列表页都有字典列(状态/优先级/类型…),
 * 各抄一份就会出现两套映射规则。
 */

/** 字典选项(只要 label 与 value 就够) */
export interface ValueEnumOption {
  /** 显示文本(字典的 dict_label) */
  label: string;
  /** 线上码(字典的 dict_value) */
  value: string;
}

/** 字典选项 → 搜索下拉的 valueEnum(label 给人看,value 是线上码) */
export function toValueEnum(
  options: ValueEnumOption[],
): Record<string, { text: string }> {
  return Object.fromEntries(
    options.map((option) => [option.value, { text: option.label }]),
  );
}
