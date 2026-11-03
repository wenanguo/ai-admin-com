import { Tag } from 'antd';
import type React from 'react';

/**
 * JSON 数组字符串 → Tag 串。
 *
 * 后端把「标签」这类数组存成 **JSON 字符串**('["财务","合规"]'),
 * 表格与详情页都要把它渲染成可读的标签串。
 *
 * 坏数据一律显示占位符 '-':解析失败、不是数组、元素不是字符串、数组为空 ——
 * 宁可空着,也不冒充数据。
 *
 * ⚠️ 页面里不要再抄一份:项目列表页与项目详情页共用这一份实现。
 *
 * @param tags 后端存的 JSON 数组字符串(空值显示占位符)
 */
export function renderJsonTags(tags?: string | null): React.ReactNode {
  if (!tags) return '-';
  let parsed: unknown;
  try {
    parsed = JSON.parse(tags);
  } catch {
    return '-';
  }
  if (!Array.isArray(parsed)) return '-';
  const labels = parsed.filter((tag): tag is string => typeof tag === 'string');
  if (labels.length === 0) return '-';
  return labels.map((tag) => <Tag key={tag}>{tag}</Tag>);
}
