/**
 * 「规则与 AI 的分工」双栏（规格 §4.2）。
 *
 * ## 这一块是**静态内容**
 *
 * 它说的是**分工的口径**（哪些结论该由规则算、哪些该由模型写），
 * 不是页面上算出来的数据 ⇒ 不发任何请求。
 *
 * ## 左栏的 ETA 那条按实情写
 *
 * 后端**没有依赖图接口**（`module_pm_task_dependency` 只有建表 SQL，
 * 没有 model、没有 controller）⇒ CPM 关键路径**不可用** ⇒
 * ETA 实际只有 burndown 外推，**没有 P50/P90**。
 *
 * ⚠️ 页面不能承诺它给不出来的东西（原型的文案里有 P50/P90，是按依赖图
 * 存在写的）。
 */
import { Alert, theme } from 'antd';
import type React from 'react';

/** 左栏：规则引擎算得出来的东西。 */
const RULE_ENGINE_ITEMS: readonly string[] = [
  '里程碑健康度（进度 / 速度比 / 阻塞时长 → 有风险、已错过）',
  '进度三口径（任务完成率 / 估时完成率 / 里程碑达成率）',
  '风险 score = 概率 × 影响，等级四级映射',
  '5 类风险自动识别（延期 / 阻塞 / 过载 / 流失 / 范围蔓延）',
  'ETA 预测（burndown 外推；依赖图接口后端尚无 ⇒ 无关键路径、无 P50/P90）',
  '相对日期解析（周起点、时区、闭区间）',
];

/** 右栏：模型该干的活。 */
const LLM_ITEMS: readonly string[] = [
  '自然语言 → 命令参数抽取',
  '把规则算出的结论写成人类可读的说明',
  '建议下一步动作（拆任务 / 排期 / 指派）',
  '纪要与评论的结构化摘要',
];

/**
 * 右栏的淡紫底。
 *
 * ⚠️ antd 6 **没有** `colorPurple` 这个 token（紫色是预设色 `#722ED1`，
 * 见 `src/components/ai-workspace/palette.ts`）⇒ 这里用它的浅色底。
 */
const LLM_BACKGROUND = '#F9F0FF';

/**
 * 「规则与 AI 的分工」的 props。
 */
export interface RuleSplitProps {
  /**
   * 侧栏窄 ⇒ 两栏并排放不下 ⇒ 改成上下堆叠。
   *
   * ⚠️ 默认**不**堆叠（保持原来的并排双栏）。
   */
  stacked?: boolean;
}

/** 一栏（标题 + 条目）。 */
interface SplitColumnProps {
  /** 栏的标识（挂成 `data-role`，给测试与样式用）。 */
  testId: string;
  /** 栏标题。 */
  title: string;
  /** 栏里的一句话说明。 */
  subtitle: string;
  /** 条目。 */
  items: readonly string[];
  /** 底色。 */
  background: string;
  /** 标题颜色。 */
  titleColor: string;
  /**
   * 上下堆叠（侧栏里两栏并排放不下）。
   *
   * ⇒ 栏**不抢**宽度（`flex: none`），自己占满整行。
   */
  stacked?: boolean;
}

/** 一栏。 */
function SplitColumn({
  testId,
  title,
  subtitle,
  items,
  background,
  titleColor,
  stacked = false,
}: SplitColumnProps): React.ReactElement {
  const { token } = theme.useToken();
  return (
    <div
      data-role={testId}
      style={{
        // ⚠️ 并排时两栏平分宽度；堆叠时**不抢**宽度（自己占满整行）。
        flex: stacked ? 'none' : 1,
        width: stacked ? '100%' : undefined,
        minWidth: 0,
        padding: token.padding,
        borderRadius: token.borderRadiusLG,
        background,
      }}
    >
      <div style={{ fontWeight: 600, color: titleColor }}>{title}</div>
      <div
        style={{
          fontSize: token.fontSizeSM,
          color: token.colorTextSecondary,
          marginBottom: token.sizeSM,
        }}
      >
        {subtitle}
      </div>
      <ul style={{ margin: 0, paddingLeft: token.paddingLG }}>
        {items.map((item) => (
          <li key={item} style={{ marginBottom: token.sizeXS }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 「规则与 AI 的分工」双栏。
 *
 * @param props `stacked` = 侧栏窄 ⇒ 两栏并排放不下 ⇒ 改成上下堆叠。
 */
export function RuleSplit({
  stacked = false,
}: RuleSplitProps = {}): React.ReactElement {
  const { token } = theme.useToken();

  return (
    <div data-role="ai-rule-split">
      <div
        style={{
          display: 'flex',
          gap: token.size,
          // ⚠️ 并排时两栏平分一行；堆叠时改成**上下**（一行放不下 360px）。
          flexDirection: stacked ? 'column' : 'row',
          flexWrap: stacked ? 'nowrap' : 'wrap',
        }}
      >
        <SplitColumn
          testId="ai-split-rule-engine"
          title="规则引擎"
          subtitle="算得准、可复现：同一份数据每次都得出同一个结论"
          items={RULE_ENGINE_ITEMS}
          background={token.colorSuccessBg}
          titleColor={token.colorSuccessText}
          stacked={stacked}
        />
        <SplitColumn
          testId="ai-split-llm"
          title="LLM"
          subtitle="说得清、接得住：把结论讲成人话，把人话变成参数"
          items={LLM_ITEMS}
          background={LLM_BACKGROUND}
          titleColor="#722ED1"
          stacked={stacked}
        />
      </div>
      <div style={{ marginTop: token.sizeSM }}>
        <Alert
          type="warning"
          showIcon
          data-role="ai-split-boundary"
          title="边界"
          description={
            <span>
              LLM 不能写库、不能定权限、不能自己决定「要不要人确认」。
              破坏性操作一律先进待确认队列；所有写操作都留审计
              （撤销入口尚未开放）。
            </span>
          }
        />
      </div>
    </div>
  );
}
