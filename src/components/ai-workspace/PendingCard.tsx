/**
 * 待确认卡片（规格 §3.5）。
 *
 * 结构照原型：头（命令名 + 状态标签）→ 标题 → 命中清单 → 规则警告 → 三个按钮。
 *
 * ## 三个按钮为什么是禁用的
 *
 * 服务端**只有** `GET /api/pending` 这一个端点 —— 「确认执行 / 取消 / 调整范围」
 * 的写入口属完整版计划（挂起/恢复）。⇒ 按钮**留着但禁用**，并用 Tooltip 说明
 * 「该能力尚未开放」——
 * - 不发一个注定 404 的请求；
 * - 也不把按钮悄悄藏起来（缺按钮用户会以为功能不存在，禁用+理由更清楚）。
 *
 * ## 命中清单怎么画
 *
 * 逐行式（不是表格）—— 侧栏只有 400px 宽，表格挤不下。
 * 原值带删除线（次要色），新值加重。
 */
import { Alert, Button, Tag, Tooltip, theme } from 'antd';
import type React from 'react';
import type { AiPendingRow } from '@/services/api/ai/types';
import { fromNow, remainingMs } from './time';

/** 离过期不到这么多毫秒就标红（规格 §3.5）。 */
const URGENT_MS = 5 * 60 * 1000;

/** 预览里的一条命中。 */
export interface PendingHit {
  /** 实体标题。 */
  title?: string;
  /** 原值。 */
  from?: string;
  /** 新值。 */
  to?: string;
  /** 负责人。 */
  owner?: string;
}

/**
 * 待确认的预览（服务端 JSON 列，**原样透出**）。
 *
 * ⚠️ 这一列是自由 JSON —— 形状**不保证**，每个字段都当「可能没有」处理。
 */
export interface PendingPreview {
  /** 一句话说清这次要干什么。 */
  title?: string;
  /** 起因（用户原话）。 */
  reason?: string;
  /** 命中清单。 */
  hits?: PendingHit[];
  /** 规则算出来的警告。 */
  warning?: string;
}

/** 取字符串（不是字符串就当没有）。 */
function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** JSON → 命中清单（不是数组就当没有）。 */
function toHits(value: unknown): PendingHit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const hits: PendingHit[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const source = item as Record<string, unknown>;
    hits.push({
      title: asText(source.title),
      from: asText(source.from),
      to: asText(source.to),
      owner: asText(source.owner),
    });
  }
  return hits;
}

/**
 * 未知的 JSON → 预览。
 *
 * ⚠️ 这一列可能**什么都不是**（空的、字符串、数组）⇒ 一律收窄成空预览，绝不崩。
 */
export function toPendingPreview(value: unknown): PendingPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  return {
    title: asText(source.title),
    reason: asText(source.reason),
    warning: asText(source.warning),
    hits: toHits(source.hits),
  };
}

/** 状态标签的取值。 */
interface StatusTag {
  /** antd Tag 的预设色。 */
  color: 'default' | 'processing' | 'success' | 'error' | 'warning';
  /** 给用户看的字。 */
  text: string;
}

/** 状态 → 标签（服务端的状态枚举见 `pending-query.ts` 的 `PendingStatus`）。 */
function statusTag(status: string): StatusTag {
  switch (status) {
    case 'CONFIRMED':
      return { color: 'success', text: '已确认' };
    case 'REJECTED':
      return { color: 'error', text: '已拒绝' };
    case 'EXPIRED':
      return { color: 'default', text: '已过期' };
    case 'EXECUTED':
      return { color: 'success', text: '已执行' };
    case 'PENDING':
      return { color: 'warning', text: '待确认' };
    default:
      return { color: 'default', text: status || '待确认' };
  }
}

/**
 * 一条命中的 key。
 *
 * ⚠️ 预览里没有每条命中的 id ⇒ 用它自己的内容拼一个。
 * （预览是入库时的快照，不会重排 ⇒ 内容做 key 是稳的。）
 */
function hitKey(itemId: string, hit: PendingHit): string {
  return `${itemId}-hit-${hit.title ?? ''}-${hit.from ?? ''}-${hit.to ?? ''}`;
}

/** 待确认卡片的 props。 */
export interface PendingCardProps {
  /** 要渲染的那一行。 */
  item: AiPendingRow;
}

/**
 * 一张待确认卡片。
 */
export function PendingCard({ item }: PendingCardProps): React.ReactElement {
  const { token } = theme.useToken();
  const preview = toPendingPreview(item.preview);
  const tag = statusTag(item.status);
  const expires = fromNow(item.expiresAt);
  // ≤ 5 分钟就标红（也包括已经过期的）
  const urgent = remainingMs(item.expiresAt) <= URGENT_MS;

  return (
    <div
      data-role="pending-card"
      style={{
        padding: token.sizeSM,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: token.sizeSM,
        }}
      >
        {/*
          ⚠️ 命令名用 antd 的**主题感知**紫色（`Tag color="purple"`）：
          写死 `#722ED1`（`palette.ts`）在**深色模式**下对比度不够。
        */}
        <Tag
          color="purple"
          data-role="pending-command"
          style={{
            fontFamily: token.fontFamilyCode,
            fontSize: token.fontSizeSM,
            marginInlineEnd: 0,
          }}
        >
          ⌨ {item.command}
        </Tag>
        <Tag color={tag.color}>{tag.text}</Tag>
      </div>

      {preview.title ? (
        <div
          data-role="pending-title"
          style={{ marginTop: token.sizeXS, fontWeight: 500 }}
        >
          {preview.title}
        </div>
      ) : null}

      {preview.reason ? (
        <div
          data-role="pending-reason"
          style={{
            marginTop: token.sizeXS,
            fontSize: token.fontSizeSM,
            color: token.colorTextSecondary,
          }}
        >
          来自：{preview.reason}
        </div>
      ) : null}

      {preview.hits && preview.hits.length > 0 ? (
        <div
          data-role="pending-hits"
          style={{
            marginTop: token.sizeSM,
            padding: token.sizeSM,
            background: token.colorBgLayout,
            borderRadius: token.borderRadius,
          }}
        >
          {preview.hits.map((hit) => (
            <div
              key={hitKey(item.id, hit)}
              data-role="pending-hit"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: token.sizeXS,
                fontSize: token.fontSizeSM,
              }}
            >
              <span style={{ color: token.colorTextTertiary }}>↳</span>
              <span data-role="hit-title">{hit.title}</span>
              {hit.from ? (
                <>
                  <span
                    data-role="hit-from"
                    style={{
                      color: token.colorTextSecondary,
                      textDecoration: 'line-through',
                    }}
                  >
                    {hit.from}
                  </span>
                  <span style={{ color: token.colorTextTertiary }}>→</span>
                </>
              ) : null}
              {hit.to ? (
                <span data-role="hit-to" style={{ fontWeight: 600 }}>
                  {hit.to}
                </span>
              ) : null}
              {hit.owner ? (
                <span
                  data-role="hit-owner"
                  style={{ color: token.colorTextTertiary }}
                >
                  {hit.owner}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {preview.warning ? (
        <div style={{ marginTop: token.sizeSM }}>
          <Alert type="warning" showIcon title={preview.warning} />
        </div>
      ) : null}

      <div
        style={{
          marginTop: token.sizeSM,
          display: 'flex',
          alignItems: 'center',
          gap: token.sizeXS,
          flexWrap: 'wrap',
        }}
      >
        {/*
          ⚠️ 禁用按钮不派发鼠标事件 ⇒ Tooltip 必须挂在**外面那层 span** 上，
          否则鼠标移上去什么都不显示。
        */}
        <Tooltip title="该能力尚未开放">
          <span data-role="pending-action">
            <Button size="small" type="primary" disabled>
              确认执行
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="该能力尚未开放">
          <span data-role="pending-action">
            <Button size="small" disabled>
              取消
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="该能力尚未开放">
          <span data-role="pending-action">
            <Button size="small" disabled>
              调整范围
            </Button>
          </span>
        </Tooltip>
        {expires ? (
          <span
            data-role="pending-expires"
            style={{
              marginLeft: 'auto',
              fontSize: token.fontSizeSM,
              color: urgent ? token.colorError : token.colorTextTertiary,
            }}
          >
            {expires}过期
          </span>
        ) : null}
      </div>
    </div>
  );
}
