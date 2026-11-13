/**
 * 「可用技能」入口 —— 让**写技能的人**看得见自己写的技能生效了。
 *
 * ## 为什么是「按钮 + 弹层」而不是一块常驻内容
 *
 * ⚠️ 宽屏页是「**一屏铺满**」的布局：对话区要吃满剩余高度（e2e 里有断言）
 * ⇒ 任何**纵向**的常驻内容都会把对话区挤矮 ⇒ 布局回归。
 * ⇒ 所以这里做成**一行按钮**（放在「当前模型」那一行里）⇒ 零纵向占用。
 *
 * ## 只读
 *
 * 这里不提供编辑/新建（那是以后的事）。
 */
import { Button, Empty, Popover, Spin, Tag, theme } from 'antd';
import type React from 'react';
import { useEffect, useState } from 'react';
import { listAiSkills } from '@/services/api/ai/client';
import type { AiSkillSummary } from '@/services/api/ai/types';

/** 区块的 props。 */
export interface SkillListProps {
  /** 技能清单（不给就自己读）。 */
  skills?: AiSkillSummary[];
}

/**
 * 可用技能入口（点开看清单）。
 */
export function SkillList({ skills }: SkillListProps): React.ReactElement {
  const { token } = theme.useToken();
  const [loaded, setLoaded] = useState<AiSkillSummary[] | undefined>(skills);
  const [loading, setLoading] = useState(skills === undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (skills !== undefined) {
      return undefined;
    }
    let disposed = false;
    setLoading(true);
    void listAiSkills()
      .then((rows) => {
        if (!disposed) {
          setLoaded(rows);
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : '读取失败');
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [skills]);

  const items = loaded ?? [];

  /** 弹层内容。 */
  const content = (
    <div style={{ width: 320 }}>
      {error ? (
        <span style={{ color: token.colorError }}>{error}</span>
      ) : loading && items.length === 0 ? (
        <Spin size="small" />
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有技能" />
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: token.sizeXS,
          }}
        >
          {items.map((skill) => (
            <div
              key={skill.name}
              data-role="skill-item"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: token.sizeXS,
              }}
            >
              <Tag
                color="purple"
                style={{
                  fontFamily: token.fontFamilyCode,
                  fontSize: token.fontSizeSM,
                  marginInlineEnd: 0,
                }}
              >
                {skill.name}
              </Tag>
              <span
                data-role="skill-description"
                style={{
                  fontSize: token.fontSizeSM,
                  color: token.colorTextSecondary,
                }}
              >
                {skill.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      title="可用技能（写在 backend/ai/.pi/skills 下的 SKILL.md）"
      trigger="click"
      placement="bottom"
    >
      <Button size="small" data-role="ai-skill-list">
        可用技能 {items.length}
      </Button>
    </Popover>
  );
}
