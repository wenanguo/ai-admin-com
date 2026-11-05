/**
 * 待确认页签（规格 §3.5）。
 *
 * 一列待确认卡片；没有就空态。
 *
 * ⚠️ 这一层是**纯展示**的：数据在 `useAiLists` 里取回，这里只负责摆出来。
 */
import { Alert, Empty, Spin, theme } from 'antd';
import type React from 'react';
import type { AiPendingRow } from '@/services/api/ai/types';
import { PendingCard } from './PendingCard';

/** 待确认页签的 props。 */
export interface PendingPanelProps {
  /** 待确认的行。 */
  items: AiPendingRow[];
  /** 还在读。 */
  loading?: boolean;
  /** 读失败了（AI 服务不可达之类）。 */
  error?: string;
}

/**
 * 待确认页签。
 */
export function PendingPanel({
  items,
  loading,
  error,
}: PendingPanelProps): React.ReactElement {
  const { token } = theme.useToken();

  /** 列表区（读不出、还在读、没有数据是三种不同的样子）。 */
  const renderBody = (): React.ReactNode => {
    if (error) {
      return <Alert type="error" showIcon title={error} />;
    }
    if (loading && items.length === 0) {
      return (
        <div style={{ padding: token.padding, textAlign: 'center' }}>
          <Spin size="small" />
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div style={{ textAlign: 'center' }}>
              <div>没有待确认的操作</div>
              <div
                style={{
                  fontSize: token.fontSizeSM,
                  color: token.colorTextSecondary,
                }}
              >
                批量与破坏性操作会先在这里等你点头
              </div>
            </div>
          }
        />
      );
    }
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: token.sizeSM,
          padding: token.sizeSM,
        }}
      >
        {items.map((item) => (
          <PendingCard key={item.id} item={item} />
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {renderBody()}
      </div>
    </div>
  );
}
