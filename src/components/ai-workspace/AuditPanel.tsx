/**
 * 审计页签（规格 §3.6）。
 *
 * 一列审计条目 + 底部的 append-only 脚注。
 *
 * ## 为什么没有撤销按钮
 *
 * 服务端**没有** `POST /api/audit/:id/undo`（补偿撤销属完整版计划）⇒
 * 这一刀**不渲染撤销按钮** —— 画一个点了就 404 的按钮是骗人。
 *
 * ## 脚注为什么保留
 *
 * 「审计记录 append-only：撤销是新增一条指向原记录的日志，不修改原记录。」
 * 这不是装饰 —— 它说的是这套审计的**语义**：撤销不改历史，只追加一条新日志。
 */
import { Alert, Empty, Spin, Tag, theme } from 'antd';
import type React from 'react';
import type { AiAuditRow } from '@/services/api/ai/types';
import { AI_PURPLE } from './palette';
import { fromNow } from './time';

/** 审计页签的 props。 */
export interface AuditPanelProps {
  /** 审计的行（新的在前，服务端就是这么排的）。 */
  items: AiAuditRow[];
  /** 还在读。 */
  loading?: boolean;
  /** 读失败了（AI 服务不可达之类）。 */
  error?: string;
}

/** 审计行的标签。 */
interface RowTag {
  /** antd Tag 的预设色。 */
  color: 'default' | 'purple';
  /** 给用户看的字。 */
  text: string;
}

/**
 * 一行审计的标签。
 *
 * - `undoOf` 有值 ⇒ 这一行是**指向原记录的撤销日志**（append-only 的那一半）；
 * - `undoneAt` 有值 ⇒ 原来的记录已经被撤销过了；
 * - 都没有 ⇒ 这一行在这里**只能看**（服务端没有撤销端点）。
 */
function rowTag(row: AiAuditRow): RowTag {
  if (row.undoOf) {
    return { color: 'purple', text: '撤销记录' };
  }
  if (row.undoneAt) {
    return { color: 'default', text: '已撤销' };
  }
  return { color: 'default', text: '只读' };
}

/**
 * 执行人。
 *
 * ⚠️ 服务端的 `actorName` 是**调用方自己的身份**（同一页里每行都一样）⇒
 * AI 起的头显示「AI 助理」，用户自己起的头才显示用户名。
 */
function actorLabel(row: AiAuditRow): string {
  if (row.actorType === 'AI') {
    return 'AI 助理';
  }
  return row.actorName || '用户';
}

/**
 * 审计页签。
 */
export function AuditPanel({
  items,
  loading,
  error,
}: AuditPanelProps): React.ReactElement {
  const { token } = theme.useToken();

  /** 列表区（读不出、还在读、没有数据是三种不同的样子）。 */
  const renderBody = (): React.ReactNode => {
    if (error) {
      return (
        <div style={{ padding: token.sizeSM }}>
          <Alert title={error} type="error" showIcon />
        </div>
      );
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
              <div>还没有审计记录</div>
              <div
                style={{
                  fontSize: token.fontSizeSM,
                  color: token.colorTextSecondary,
                }}
              >
                AI 的每次写入都会记在这里
              </div>
            </div>
          }
        />
      );
    }
    return (
      <div>
        {items.map((row) => {
          const tag = rowTag(row);
          return (
            <div
              key={row.id}
              data-role="audit-row"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: token.sizeSM,
                padding: token.sizeSM,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <span
                data-role="audit-dot"
                style={{
                  width: 8,
                  height: 8,
                  marginTop: 6,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background:
                    row.actorType === 'AI' ? AI_PURPLE : token.colorPrimary,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: token.sizeXS,
                  }}
                >
                  <span
                    style={{
                      fontFamily: token.fontFamilyCode,
                      fontSize: token.fontSizeSM,
                    }}
                  >
                    {row.command}
                  </span>
                  {row.error ? (
                    <span
                      data-role="audit-error"
                      style={{
                        fontSize: token.fontSizeSM,
                        color: token.colorError,
                      }}
                    >
                      {row.error}
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: token.fontSizeSM,
                    color: token.colorTextSecondary,
                  }}
                >
                  <span>{actorLabel(row)}</span>
                  <span style={{ margin: `0 ${token.sizeXS}` }}>·</span>
                  <span data-role="audit-time">{fromNow(row.createdAt)}</span>
                </div>
              </div>
              <Tag color={tag.color} style={{ marginInlineEnd: 0 }}>
                {tag.text}
              </Tag>
            </div>
          );
        })}
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
      <div
        data-role="audit-footnote"
        style={{
          padding: token.sizeSM,
          fontSize: token.fontSizeSM,
          color: token.colorTextTertiary,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        审计记录 append-only：撤销是新增一条指向原记录的日志，不修改原记录。
      </div>
    </div>
  );
}
