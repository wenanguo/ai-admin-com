/**
 * 10 类意图卡片墙（规格 §4.1）。
 *
 * ## 点击只填输入框，**不发送**
 *
 * 点了卡片只是把示例问句交给调用方（调用方填进自己的输入框）——
 * 发不发由用户决定。原型里点一下就直接出答案，那是假的前端。
 *
 * ## 每张卡片都标着「暂未开放」
 *
 * AI 服务当前只有 `create_task` 一条命令，查询类意图一条读命令都还没有
 * （理由写在每张卡片上）。
 */
import { Alert, Card, Tag, Typography, theme } from 'antd';
import type React from 'react';
import { AI_INTENTS } from './intents';

/** 意图卡片墙的 props。 */
export interface IntentGalleryProps {
  /** 点卡片：把示例问句交给调用方（**只填输入框，不发送**）。 */
  onPick: (example: string) => void;
}

/**
 * 意图卡片墙。
 *
 * @param props 卡片被点时回调。
 */
export function IntentGallery({
  onPick,
}: IntentGalleryProps): React.ReactElement {
  const { token } = theme.useToken();

  return (
    <section data-role="ai-intent-gallery">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: token.sizeSM,
          marginBottom: token.sizeSM,
        }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          10 类意图（点击即填入输入框）
        </Typography.Title>
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM }}
        >
          点一下只填输入框，不自动发送
        </Typography.Text>
      </div>
      {/*
        ⚠️ 这条说明是这一块**最要紧**的东西：
        卡片墙展示的是**意图空间**，不是十个已经能用的功能。
        不写清楚，用户点一张卡片就会以为 AI 现在就能答。
      */}
      <Alert
        type="info"
        showIcon
        data-role="ai-intent-note"
        message="这 10 类意图是意图空间的演示，不是十个已经能用的功能"
        description={
          <span>
            AI 服务当前只接通了{' '}
            <code style={{ fontFamily: token.fontFamilyCode }}>
              create_task
            </code>
            （建任务）一条命令，查询类意图一条读命令都还没有。
            标着「暂未开放」的意图现在拿不到结论 —— 卡片上写着原因。
          </span>
        }
        style={{ marginBottom: token.sizeSM }}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: token.sizeSM,
        }}
      >
        {AI_INTENTS.map((intent) => (
          <Card
            key={intent.title}
            size="small"
            hoverable
            data-role="intent-card"
            data-intent={intent.title}
            onClick={() => {
              onPick(intent.example);
            }}
            style={{ cursor: 'pointer' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: token.sizeXS,
              }}
            >
              <span style={{ fontWeight: 600 }}>{intent.title}</span>
              {/*
                ⚠️ 这个标签是**诚实性**的一部分：
                服务端没有对应命令 ⇒ 不能让卡片看起来「点一下就有结果」。
              */}
              <Tag
                color="default"
                data-role="intent-status"
                style={{ marginInlineEnd: 0 }}
              >
                暂未开放
              </Tag>
            </div>
            <div
              style={{
                marginTop: token.sizeXS,
                color: token.colorTextSecondary,
              }}
            >
              {intent.example}
            </div>
            <div
              style={{
                marginTop: token.sizeXS,
                fontSize: token.fontSizeSM,
                color: token.colorTextTertiary,
              }}
            >
              {intent.reason}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
