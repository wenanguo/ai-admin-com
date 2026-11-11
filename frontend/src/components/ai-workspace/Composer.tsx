/**
 * 输入区：多行输入框 + 下方一行（左边两个图标、右边发送）+ 空对话时的快捷 chips。
 *
 * ## 形态
 *
 * 按原型改：一个**多行**输入框（占位「输入消息」），下面一行左边放两个
 * 图标按钮、右边放「发送」。
 *
 * ⚠️ 左下角那两个图标（图片 / 表情）**还没有对应能力**
 *    ⇒ 画成禁用的，并标「暂未开放」——
 *    与「意图卡片」「快捷 chip」同一个口径（服务端做不到的就不许假装能做）。
 *
 * ## 快捷 chips
 *
 * 快捷 chips **只填输入框**，不直接发送 ——
 * 让人先看一眼自己要点的那句话，再决定发不发。
 */
import { PictureOutlined, SmileOutlined } from '@ant-design/icons';
import { Button, Input, Tag, Tooltip, theme } from 'antd';
import type React from 'react';

/**
 * 一条快捷问句。
 */
export interface QuickPrompt {
  /** 问句（点一下只填进输入框，**不发送**）。 */
  text: string;
  /**
   * 这个问句现在能不能答。
   *
   * ⚠️ AI 服务当前**只有 `create_task`（建任务）一条命令**
   *    （服务端 `src/tools/index.ts` 的命令目录）：
   *    - **一条读命令都没有** ⇒ 查询类意图拿不到结论；
   *    - **也没有批量改期那条写命令** ⇒ 「顺延到下周一」同样执行不了。
   *
   * ⇒ 与 10 类意图卡片**同一个口径**：服务端做不到的就标上「暂未开放」
   *   （见 `src/pages/ai/workspace/intents.ts`）。
   * ⇒ **不许承诺服务端没有的能力**（那是页面在骗人）。
   */
  available: boolean;
}

/** 空对话时显示的 5 条快捷问句（规格 §3.3）。 */
export const QUICK_PROMPTS: readonly QuickPrompt[] = [
  // 建任务 ⇒ 服务端**能**做（唯一一条命令）。
  { text: '@AI 建一个 SSO 登录任务', available: true },
  // ↓↓ 下面四条服务端都**做不了** ⇒ 标「暂未开放」。
  // 批量改期 ⇒ 服务端没有「改期」那条写命令（只有建任务）。
  { text: '本周所有 P0 顺延到下周一', available: false },
  // 进度查询（与意图卡片「进度查询」同一类）。
  { text: '「预付款模块」还能按期完成吗？', available: false },
  // 风险查询（与意图卡片「风险查询」同一句问法）。
  { text: '识别「财务对账系统」的潜在风险', available: false },
  // 总结查询（与意图卡片「总结查询」同一类）。
  { text: '总结本周项目亮点与风险', available: false },
];

/** 输入区的 props。 */
export interface ComposerProps {
  /** 输入框里的内容。 */
  value: string;
  /** 输入内容变了。 */
  onChange: (value: string) => void;
  /** 点发送或按回车。 */
  onSend: () => void;
  /** 本轮进行中：禁用输入并提示。 */
  busy?: boolean;
  /** 空对话时显示快捷 chips。 */
  showChips?: boolean;
  /** 输入框的占位文案（缺省「输入消息」）。 */
  placeholder?: string;
  /**
   * 点「停止生成」（本轮进行中时才有这个按钮）。
   *
   * ⚠️ **没有它就是死路**：本轮进行中时输入框是禁用的、发送也点不了
   *    ⇒ 模型跑飞（工具卡住、模型陷入长思考）时用户只能干等。
   */
  onStop?: () => void;
  /** 正在中止（按钮转圈、不可重复点）。 */
  stopping?: boolean;
}

/**
 * 输入区。
 */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  showChips,
  placeholder = '输入消息',
  onStop,
  stopping,
}: ComposerProps): React.ReactElement {
  const { token } = theme.useToken();

  return (
    <div>
      {showChips ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: token.sizeXS,
            marginBottom: token.sizeSM,
          }}
        >
          {QUICK_PROMPTS.map((prompt) => (
            <Tag
              key={prompt.text}
              style={{ cursor: 'pointer' }}
              title={
                prompt.available
                  ? undefined
                  : '该意图暂未开放（AI 服务还没有对应的命令）'
              }
              onClick={() => onChange(prompt.text)}
            >
              {prompt.text}
              {prompt.available ? null : (
                // ⚠️ 拿不到结论的意图必须**标出来**（与意图卡片一个口径）
                <span style={{ marginInlineStart: 4, opacity: 0.75 }}>
                  暂未开放
                </span>
              )}
            </Tag>
          ))}
        </div>
      ) : null}
      {busy ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: token.sizeXS,
            fontSize: token.fontSizeSM,
            color: token.colorTextSecondary,
          }}
        >
          <span>本轮进行中…</span>
          {/*
            ⚠️ **停止按钮**：本轮进行中时输入框是禁用的 ⇒ 没有这个按钮
            用户就没有任何出路（模型跑飞时只能干等）。
            ⇒ 它就在「本轮进行中…」旁边，不藏在别处。
          */}
          {onStop ? (
            <Button
              size="small"
              danger
              loading={stopping === true}
              onClick={onStop}
              data-role="ai-stop-button"
            >
              停止生成
            </Button>
          ) : null}
        </div>
      ) : null}
      {/*
        输入框：**多行**。

        ⚠️ 回车发送、Shift+回车换行（聊天框的惯例）。
           `onPressEnter` 不分修饰键 ⇒ 这里自己判 Shift。
      */}
      <Input.TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={(event) => {
          if (event.shiftKey) {
            return;
          }
          event.preventDefault();
          onSend();
        }}
        placeholder={placeholder}
        disabled={busy}
        autoSize={{ minRows: 3, maxRows: 8 }}
        style={{ resize: 'none' }}
      />
      {/* 下面一行：左边两个图标（暂未开放），右边发送 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: token.sizeXS,
          marginTop: token.sizeXS,
        }}
      >
        <Tooltip title="图片消息暂未开放（AI 服务还没有对应的命令）">
          <span>
            <Button
              type="text"
              size="small"
              aria-label="发送图片（暂未开放）"
              icon={<PictureOutlined />}
              disabled
            />
          </span>
        </Tooltip>
        <Tooltip title="表情暂未开放（AI 服务还没有对应的命令）">
          <span>
            <Button
              type="text"
              size="small"
              aria-label="插入表情（暂未开放）"
              icon={<SmileOutlined />}
              disabled
            />
          </span>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          onClick={onSend}
          disabled={busy || value.trim().length === 0}
        >
          发送
        </Button>
      </div>
    </div>
  );
}
