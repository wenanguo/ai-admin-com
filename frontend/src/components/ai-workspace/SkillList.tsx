/**
 * 「可用技能」区块 —— 让**写技能的人**看得见自己写的技能生效了。
 *
 * ## 为什么要有它
 *
 * 技能（`backend/ai/.pi/skills` 下的 SKILL.md）是业务同学自己写的
 * ⇒ 写完要能确认「它被加载了」⇒ 界面上列出来。
 *
 * ⚠️ **只读**：这里不提供编辑/新建（那是以后的事）。
 */
import { Alert, Empty, Spin, Tag, theme } from 'antd';
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
 * 可用技能清单。
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

  return (
    <section
      data-role="ai-skill-list"
      style={{
        padding: `${token.paddingSM}px ${token.padding}px`,
        borderRadius: token.borderRadiusLG,
        background: token.colorFillQuaternary,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: token.sizeXS,
          marginBottom: token.sizeXS,
        }}
      >
        <span style={{ fontWeight: 600 }}>可用技能</span>
        <span
          style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}
        >
          写在 backend/ai/.pi/skills 下的 SKILL.md —— 改完重启即可生效
        </span>
      </div>

      {error ? (
        <Alert type="error" showIcon title={error} />
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
                flexWrap: 'wrap',
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
    </section>
  );
}
