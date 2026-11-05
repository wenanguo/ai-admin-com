/**
 * 输入区：单行输入 + 发送按钮 + 空对话时的快捷 chips。
 *
 * ⚠️ 快捷 chips **只填输入框**，不直接发送 ——
 * 让人先看一眼自己要点的那句话，再决定发不发。
 */
import { Button, Input, Tag, theme } from 'antd';
import type React from 'react';

/** 空对话时显示的 5 条快捷问句（规格 §3.3）。 */
export const QUICK_PROMPTS = [
  '@AI 建一个 SSO 登录任务',
  '本周所有 P0 顺延到下周一',
  '「预付款模块」还能按期完成吗？',
  '识别「财务对账系统」的潜在风险',
  '总结本周项目亮点与风险',
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
              key={prompt}
              style={{ cursor: 'pointer' }}
              onClick={() => onChange(prompt)}
            >
              {prompt}
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
          placeholder="说点什么…"
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
