/**
 * 相对时间（规格 §3.5 / §3.6 说「2 分钟前」「3 分钟后过期」）。
 *
 * ⚠️ 固定用 **zh-cn**：这一刀的界面文案全是中文硬编码，相对时间跟着中文走；
 * 另外 dayjs 的缺省语言是英文，用例里也拿不到确定的中文串。
 */
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/**
 * ISO 时间 → 相对时间（「2 分钟前」「3 分钟后」）。
 *
 * 时间缺失或不合法时返回空串（调用方自己决定要不要显示）。
 */
export function fromNow(iso?: string | null): string {
  if (!iso) {
    return '';
  }
  const value = dayjs(iso).locale('zh-cn');
  if (!value.isValid()) {
    return '';
  }
  return value.fromNow();
}

/**
 * 距离某个时间点还剩多少毫秒（已经过期是负数）。
 *
 * 时间缺失或不合法时返回 `Infinity`（当作「不会过期」）。
 */
export function remainingMs(
  iso?: string | null,
  now: number = Date.now(),
): number {
  if (!iso) {
    return Number.POSITIVE_INFINITY;
  }
  const value = dayjs(iso);
  if (!value.isValid()) {
    return Number.POSITIVE_INFINITY;
  }
  return value.valueOf() - now;
}
