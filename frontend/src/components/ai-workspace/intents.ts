/**
 * 10 类意图卡片（原型 `docs/aipm/prototype/ai-assistant.html`）。
 *
 * ## 每张卡片都标着「暂未开放」—— 为什么
 *
 * AI 服务（`D:/project/ai-admin-ai`）当前**只有一个命令**：`create_task`（建任务），
 * 而且**一条读命令都还没有**（见服务端 `src/tools/index.ts` 的命令目录）。
 * 这 10 类意图全是**查询类**的 ⇒ 现在发过去，服务端只能答「我只会建任务」。
 *
 * ⇒ 卡片上明写「暂未开放」，并给出**为什么**（数据在不在、AI 侧的读命令接上没有），
 * 免得用户以为点一下就能拿到结论。
 *
 * ⚠️ **别把这里写成「已实现 5/10」**（原型里就是这么写的）——
 * 那是原型自己编的数字，后端并没有这些能力。
 */

/** 一张意图卡片。 */
export interface AiIntent {
  /** 意图名（卡片标题）。 */
  title: string;
  /** 示例问句（点一下就填进输入框，**不发送**）。 */
  example: string;
  /** 还没开放的原因（一句话，给用户看）。 */
  reason: string;
}

/**
 * 10 类意图。
 *
 * ⚠️ 顺序与原型一致（进度 → Owner → 风险 → 负载 → 依赖 → 历史相似 → 总结 → SLA → 文档 → 建议）。
 */
export const AI_INTENTS: readonly AiIntent[] = [
  {
    title: '进度查询',
    example: '上周我负责的项目进度如何？哪个有延期风险？',
    reason: '项目与任务的进度字段后端有，但 AI 侧还没有读命令',
  },
  {
    title: 'Owner 查询',
    example: '谁在 P0 任务上阻塞我？',
    reason: '任务的负责人字段后端有，但 AI 侧还没有读命令',
  },
  {
    title: '风险查询',
    example: '识别「财务对账系统」的潜在风险',
    reason: '风险表与 score 后端有，但 AI 侧还没有读命令',
  },
  {
    title: '负载查询',
    example: 'PM 王芳目前负载如何？',
    reason: '后端没有「个人负载」这个口径（原型里的 92% 是它自己编的）',
  },
  {
    title: '依赖查询',
    example: '任务 #1001 的关键依赖？',
    reason: '后端没有依赖图（依赖表只有建表 SQL，没有读接口）',
  },
  {
    title: '历史相似',
    example: '有没有类似 SSO 接 OA 的历史项目？',
    reason: '后端没有相似项目的检索',
  },
  {
    title: '总结查询',
    example: '总结这个项目的关键里程碑',
    reason: '里程碑数据后端有，但 AI 侧还没有读命令',
  },
  {
    title: 'SLA 查询',
    example: '财务对账系统 SLA 是否安全？',
    reason: '后端没有 SLA 的数据与口径',
  },
  {
    title: '文档查询',
    example: 'SSO 选型报告在哪？',
    reason: '后端没有文档库',
  },
  {
    title: '建议查询',
    example: '本周该关注什么？',
    reason: '建议要靠读命令与规则结论，AI 侧还没有读命令',
  },
];
