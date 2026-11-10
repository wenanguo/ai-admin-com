/**
 * 「当前讨论」条 —— **常驻在面板头部下面**（对话 / 待确认 / 审计三个页签都在）。
 *
 * ## 为什么放在这里（而不是对话页签里）
 *
 * 用户点完「与 AI 讨论」之后，最需要知道的是「**我现在在聊哪条任务**」。
 * ⇒ 放在对话页签里的话，用户停在「待确认」「审计」页签时就**看不到任何提示**
 *    ⇒ 表现为「点了讨论，AI 工作台一点反应都没有」。
 * ⇒ 放在头部下面 ⇒ **切哪个页签都在**。
 *
 * ## 显示什么
 *
 * - 任务：id + 标题（用户在列表/看板/甘特里点的**那一行**）；
 * - 所属项目 / 所属里程碑（任务行里只有 id，名字是侧载出来的）；
 * - 当前状态（**线上码 + 中文**，模型那边也是这个口径）；
 * - 「结束讨论」：清掉当前上下文（下一条消息就不再带它了）。
 */
import { CloseCircleOutlined } from '@ant-design/icons';
import { Button, Tag, theme } from 'antd';
import type React from 'react';
import type { AiTaskContext } from '@/services/api/ai/types';

/** 条的 props。 */
export interface DiscussionBarProps {
  /** 当前讨论的上下文（null = 没在讨论某条任务）。 */
  context: AiTaskContext | null;
  /** 结束讨论（清掉上下文）。 */
  onClear: () => void;
}

/**
 * 取一个字段的中文名（上下文里带的是「线上码 → 中文」那张表）。
 */
function labelOf(
  labels: Record<string, string> | undefined,
  code: unknown,
): string | undefined {
  if (typeof code !== 'string') {
    return undefined;
  }
  return labels?.[code];
}

/**
 * 当前讨论条。
 *
 * @returns 没有上下文 ⇒ 什么都不渲染（null）。
 */
export function DiscussionBar({
  context,
  onClear,
}: DiscussionBarProps): React.ReactElement | null {
  const { token } = theme.useToken();
  if (context === null) {
    return null;
  }

  const task = context.task;
  const title = String(task['title'] ?? '').trim();
  const statusCode =
    typeof task['status_code'] === 'string' ? task['status_code'] : undefined;
  const statusLabel = labelOf(context.labels, statusCode);

  return (
    <div
      data-testid="ai-context-bar"
      data-role="ai-discussion-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.sizeXS,
        padding: `${token.paddingSM}px ${token.padding}px`,
        background: token.colorFillQuaternary,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        fontSize: token.fontSizeSM,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: token.sizeXS,
        }}
      >
        <Tag color="processing" style={{ marginInlineEnd: 0 }}>
          正在讨论
        </Tag>
        <span
          data-role="ai-discussion-title"
          style={{
            color: token.colorText,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={title}
        >
          #{task.id} {title.length > 0 ? title : '（无标题）'}
        </span>
        <Button
          size="small"
          type="text"
          icon={<CloseCircleOutlined />}
          onClick={onClear}
          style={{ marginLeft: 'auto', flexShrink: 0, padding: 0 }}
        >
          结束讨论
        </Button>
      </div>
      {/*
        第二行：所属项目 / 所属里程碑 / 当前状态。

        ⚠️ 用户要在这里确认「我聊的是**哪条**任务」⇒ 光有标题不够
        （同名任务很多）⇒ 项目与里程碑必须一起显示。
      */}
      <div
        data-role="ai-discussion-meta"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${token.sizeXS}px ${token.sizeSM}px`,
          color: token.colorTextSecondary,
        }}
      >
        {context.project ? (
          <span data-role="ai-discussion-project">
            所属项目：{context.project.name}
          </span>
        ) : null}
        {context.milestone ? (
          <span data-role="ai-discussion-milestone">
            所属里程碑：{context.milestone.name}
          </span>
        ) : null}
        {statusCode ? (
          <span data-role="ai-discussion-status">
            当前状态：
            {statusLabel ? `${statusLabel}（${statusCode}）` : statusCode}
          </span>
        ) : null}
        {context.names?.assignee ? (
          <span data-role="ai-discussion-assignee">
            负责人：{context.names.assignee}
          </span>
        ) : null}
      </div>
    </div>
  );
}
