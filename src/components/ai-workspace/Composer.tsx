/**
 * 输入区：单行输入 + 发送按钮 + 空对话时的快捷 chips。
 *
 * ⚠️ 快捷 chips **只填输入框**，不直接发送 ——
 * 让人先看一眼自己要点的那句话，再决定发不发。
 */
import { Button, Input, Tag, theme } from 'antd';
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
  /** 输入框的占位文案（缺省「说点什么…」）。 */
  placeholder?: string;
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
  placeholder = '说点什么…',
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
            fontSize: token.fontSizeSM,
            color: token.colorTextSecondary,
          }}
        >
          本轮进行中…
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: token.sizeSM }}>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPressEnter={onSend}
          placeholder={placeholder}
          disabled={busy}
        />
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
