/* ============================================================
 * 全局 mock 数据 —— 字段名与 PRD §5 对齐
 * window.MOCK = { users, projects, milestones, tasks, risks, comments, meetings }
 * ============================================================ */
(function () {
  const users = [
    { id: 1, username: 'zhangwei', name: '张伟', role: 'PMO', dept: '项目管理办公室', avatar: '张', color: '#409EFF' },
    { id: 2, username: 'lijun', name: '李军', role: 'PM', dept: '数字化项目部', avatar: '李', color: '#67C23A' },
    { id: 3, username: 'wangfang', name: '王芳', role: 'PM', dept: '财务系统部', avatar: '王', color: '#E6A23C' },
    { id: 4, username: 'zhaolei', name: '赵磊', role: 'Member', dept: '前端研发组', avatar: '赵', color: '#F56C6C' },
    { id: 5, username: 'liuyang', name: '刘洋', role: 'Member', dept: '后端研发组', avatar: '刘', color: '#909399' },
    { id: 6, username: 'chenmin', name: '陈敏', role: 'Member', dept: '测试组', avatar: '陈', color: '#9B59B6' },
    { id: 7, username: 'sunqian', name: '孙倩', role: 'Sponsor', dept: '高管', avatar: '孙', color: '#1ABC9C' },
    { id: 8, username: 'zhouxin', name: '周欣', role: 'Member', dept: '设计组', avatar: '周', color: '#E74C3C' }
  ];

  const projects = [
    {
      id: 1,
      code: 'PRJ-2026-Q3-001',
      name: '财务对账系统升级',
      description: '支持 2026 Q3 新会计准则，覆盖 12 个业务线对账自动化',
      template_id: 'tpl_finance',
      owner_id: 3,
      members: [3, 4, 5, 6, 1],
      status: 'active',
      priority: 'P0',
      start_date: '2026-06-15',
      due_date: '2026-09-30',
      tags: ['财务', '合规', '核心系统'],
      visibility: 'internal',
      health: 'yellow',
      progress: 0.62,
      budget_used: 0.71,
      created_at: '2026-06-10T10:00:00',
      updated_at: '2026-06-29T18:00:00'
    },
    {
      id: 2,
      code: 'PRJ-2026-Q3-002',
      name: 'SSO 单点登录接入',
      description: '公司 OA / 邮件 / 自研系统统一认证',
      template_id: 'tpl_infra',
      owner_id: 2,
      members: [2, 4, 5, 8],
      status: 'active',
      priority: 'P0',
      start_date: '2026-06-20',
      due_date: '2026-08-15',
      tags: ['基建', '安全'],
      visibility: 'public',
      health: 'green',
      progress: 0.45,
      budget_used: 0.32,
      created_at: '2026-06-12T09:00:00',
      updated_at: '2026-06-29T20:00:00'
    },
    {
      id: 3,
      code: 'PRJ-2026-Q3-003',
      name: '数字化营销活动平台',
      description: '618 / 双11 营销活动模板化运营',
      template_id: 'tpl_marketing',
      owner_id: 2,
      members: [2, 4, 8, 6],
      status: 'active',
      priority: 'P1',
      start_date: '2026-05-10',
      due_date: '2026-07-30',
      tags: ['营销', 'C端'],
      visibility: 'internal',
      health: 'red',
      progress: 0.35,
      budget_used: 0.88,
      created_at: '2026-05-08T10:00:00',
      updated_at: '2026-06-28T16:30:00'
    },
    {
      id: 4,
      code: 'PRJ-2026-Q3-004',
      name: '合规审计二期',
      description: '完成等保 2.0 三级认证改造',
      template_id: 'tpl_compliance',
      owner_id: 3,
      members: [3, 5, 6, 1],
      status: 'planning',
      priority: 'P1',
      start_date: '2026-07-01',
      due_date: '2026-11-30',
      tags: ['合规', '安全'],
      visibility: 'internal',
      health: 'green',
      progress: 0.05,
      budget_used: 0.02,
      created_at: '2026-06-25T10:00:00',
      updated_at: '2026-06-29T08:00:00'
    },
    {
      id: 5,
      code: 'PRJ-2026-Q3-005',
      name: '客户交付中台',
      description: '客户成功 SOP 模板化',
      template_id: 'tpl_customer',
      owner_id: 1,
      members: [1, 2, 4],
      status: 'active',
      priority: 'P2',
      start_date: '2026-06-01',
      due_date: '2026-10-15',
      tags: ['客户', 'B端'],
      visibility: 'internal',
      health: 'yellow',
      progress: 0.52,
      budget_used: 0.55,
      created_at: '2026-05-30T10:00:00',
      updated_at: '2026-06-29T19:00:00'
    }
  ];

  const milestones = [
    { id: 101, project_id: 1, name: '需求确认 + 蓝图', start_date: '2026-06-15', due_date: '2026-06-30', actual_start_date: '2026-06-15', actual_end_date: '2026-07-02', status: 'done', deliverables: ['业务蓝图 v1.0'], sort_order: 1 },
    { id: 102, project_id: 1, name: '预付款模块', start_date: '2026-07-01', due_date: '2026-07-25', actual_start_date: '2026-07-03', actual_end_date: null, status: 'in_progress', deliverables: ['预付款核销 API'], sort_order: 2, health_reason: '存在阻塞 5 天的任务：合规审批材料补充；近 14 天完成 2 项，低于所需速率 3.1 项/周' },
    { id: 103, project_id: 1, name: '开票模块', start_date: '2026-07-20', due_date: '2026-08-15', actual_start_date: null, actual_end_date: null, status: 'upcoming', deliverables: ['开票流水、冲销'], sort_order: 3 },
    { id: 104, project_id: 1, name: '对账自动化', start_date: '2026-08-10', due_date: '2026-09-05', actual_start_date: null, actual_end_date: null, status: 'upcoming', deliverables: ['对账引擎 V2'], sort_order: 4 },
    { id: 105, project_id: 1, name: '集成 + UAT', start_date: '2026-09-01', due_date: '2026-09-20', actual_start_date: null, actual_end_date: null, status: 'upcoming', deliverables: ['UAT 报告'], sort_order: 5 },
    { id: 106, project_id: 1, name: '上线交付', start_date: '2026-09-15', due_date: '2026-09-30', actual_start_date: null, actual_end_date: null, status: 'upcoming', deliverables: ['上线 runbook'], sort_order: 6 },
    { id: 201, project_id: 2, name: 'SSO 方案选型', start_date: '2026-06-20', due_date: '2026-06-30', actual_start_date: '2026-06-20', actual_end_date: '2026-06-28', status: 'done', deliverables: ['选型报告'], sort_order: 1 },
    { id: 202, project_id: 2, name: 'IdP 搭建', start_date: '2026-07-01', due_date: '2026-07-20', actual_start_date: '2026-07-01', actual_end_date: null, status: 'in_progress', deliverables: ['IdP 集群'], sort_order: 2, health_reason: '完成度 33% 且剩余 12 天；关键路径「证书服务对接」已延期 1 次' },
    { id: 203, project_id: 2, name: 'OA / 邮件对接', start_date: '2026-07-15', due_date: '2026-08-05', actual_start_date: null, actual_end_date: null, status: 'upcoming', deliverables: ['对接 adapter'], sort_order: 3 },
    { id: 204, project_id: 2, name: '灰度上线', start_date: '2026-08-05', due_date: '2026-08-15', actual_start_date: null, actual_end_date: null, status: 'upcoming', deliverables: ['灰度 runbook'], sort_order: 4 }
  ];

  const tasks = [
    // 项目 1（财务对账）—— 看板卡片
    { id: 1001, project_id: 1, milestone_id: 102, parent_id: null, title: '预付款流水 ETL 接入', description: '从 ERP 抽取预付款流水，写入对账中间表', type: 'feature', status: 'in_progress', priority: 'P0', estimate_hours: 16, actual_hours: 9, assignee_id: 5, reporter_id: 3, reviewers: [5], labels: ['backend', 'etl'], start_date: '2026-07-01', due_date: '2026-07-10', dependencies: [], ai: { suggested: true, tag: 'AI 估时 16h', comment: '基于历史任务估算' } },
    { id: 1002, project_id: 1, milestone_id: 102, parent_id: null, title: '预付款核销 UI', description: '运营人员核销预付款的前端页面', type: 'feature', status: 'todo', priority: 'P1', estimate_hours: 12, actual_hours: 0, assignee_id: 4, reporter_id: 3, reviewers: [4], labels: ['frontend'], start_date: '2026-07-05', due_date: '2026-07-15', dependencies: [1001] },
    { id: 1003, project_id: 1, milestone_id: 102, parent_id: null, title: '预付款支付幂等性', description: '防止重复支付的 idempotency-key 设计', type: 'feature', status: 'blocked', priority: 'P0', estimate_hours: 8, actual_hours: 4, assignee_id: 5, reporter_id: 3, reviewers: [5], labels: ['backend', 'risk'], start_date: '2026-07-03', due_date: '2026-07-08', dependencies: [], ai: { suggested: true, tag: 'AI 风险标记' } },
    { id: 1004, project_id: 1, milestone_id: 103, parent_id: null, title: '开票流水清单接口', description: '对账系统主动调税务系统获取开票明细', type: 'feature', status: 'backlog', priority: 'P1', estimate_hours: 14, actual_hours: 0, assignee_id: 5, reporter_id: 3, reviewers: [5], labels: ['backend', 'api'], dependencies: [] },
    { id: 1005, project_id: 1, milestone_id: 102, parent_id: null, title: '预付款单元测试', description: 'pytest + coverage 95%+', type: 'ops', status: 'review', priority: 'P2', estimate_hours: 6, actual_hours: 5, assignee_id: 6, reporter_id: 3, reviewers: [5], labels: ['test'], dependencies: [1003] },
    { id: 1006, project_id: 1, milestone_id: 101, parent_id: null, title: '业务蓝图评审通过', description: '12 个业务线蓝图评审签字', type: 'ops', status: 'done', priority: 'P1', estimate_hours: 4, actual_hours: 3, assignee_id: 3, reporter_id: 3, reviewers: [], labels: ['管理'], dependencies: [] },
    { id: 1007, project_id: 1, milestone_id: 102, parent_id: null, title: '运维监控大盘', description: 'Grafana + 钉钉告警', type: 'ops', status: 'todo', priority: 'P2', estimate_hours: 10, actual_hours: 0, assignee_id: 5, reporter_id: 3, reviewers: [], labels: ['ops'], dependencies: [1003] },
    // 项目 2（SSO）
    { id: 2001, project_id: 2, milestone_id: 202, parent_id: null, title: 'IdP 集群部署', description: 'Keycloak HA 集群', type: 'ops', status: 'in_progress', priority: 'P0', estimate_hours: 20, actual_hours: 12, assignee_id: 5, reporter_id: 2, reviewers: [5], labels: ['infra', 'security'], dependencies: [] },
    { id: 2002, project_id: 2, milestone_id: 202, parent_id: null, title: 'IdP 与 AD 联调', description: '对接公司 AD 域', type: 'feature', status: 'todo', priority: 'P1', estimate_hours: 12, actual_hours: 0, assignee_id: 5, reporter_id: 2, reviewers: [], labels: ['infra'], dependencies: [2001] },
    { id: 2003, project_id: 2, milestone_id: 203, parent_id: null, title: 'OA 登录 SDK 集成', description: 'OA 系统嵌入 SSO 登录按钮', type: 'feature', status: 'backlog', priority: 'P1', estimate_hours: 14, actual_hours: 0, assignee_id: 4, reporter_id: 2, reviewers: [], labels: ['frontend'], dependencies: [2002] },
    { id: 2004, project_id: 2, milestone_id: 201, parent_id: null, title: 'SSO 选型报告', description: 'Keycloak vs Authing 对比', type: 'research', status: 'done', priority: 'P1', estimate_hours: 6, actual_hours: 5, assignee_id: 2, reporter_id: 2, reviewers: [1], labels: ['research'], dependencies: [] },
    { id: 2005, project_id: 2, milestone_id: 203, parent_id: null, title: '邮件系统 SAML 对接', description: '与 Exchange/Postfix 对接', type: 'feature', status: 'backlog', priority: 'P2', estimate_hours: 16, actual_hours: 0, assignee_id: 5, reporter_id: 2, reviewers: [], labels: ['infra', 'security'], dependencies: [2001] }
  ];

  const risks = [
    { id: 501, project_id: 1, title: '预付款幂等设计缺陷导致重复支付', description: 'ERP 接口可能重试，需要 idempotency-key', category: 'quality', probability: 4, impact: 5, score: 20, status: 'mitigating', owner_id: 5, mitigation_plan: '引入 UUID idempotency-key + Redis 去重', contingency_plan: '紧急回滚 + 财务手工冲销', due_date: '2026-07-05', created_via: 'ai_suggested', ai_suggestion: { reason: '类似项目 PRJ-2024-Q4-002 曾发生类似问题' } },
    { id: 502, project_id: 1, title: '12 业务线蓝图签字延迟', description: '业务方 review 周期长', category: 'schedule', probability: 3, impact: 3, score: 9, status: 'analyzing', owner_id: 3, mitigation_plan: 'PMO 介入催办 + 模板预审', contingency_plan: '分批上线，先核心 6 个业务线', due_date: '2026-07-15' },
    { id: 503, project_id: 3, title: '618 营销活动上线延期', description: '设计稿交付延迟 + 后端联调不足', category: 'schedule', probability: 5, impact: 4, score: 20, status: 'identified', owner_id: 2, mitigation_plan: '增加 1 名设计 + 后端优先级插队', contingency_plan: '上线最小可用版本，运营手工补齐', due_date: '2026-07-25', created_via: 'ai_suggested', ai_suggestion: { reason: '检测到任务 #3002 完成率 15% + 截止日 < 7 天' } },
    { id: 504, project_id: 2, title: 'IdP 集群单点', description: 'Redis 主从故障导致 IdP 全局不可用', category: 'risk', probability: 2, impact: 5, score: 10, status: 'identified', owner_id: 5, mitigation_plan: 'Redis Sentinel + 多 AZ 部署', contingency_plan: '本地缓存兜底 30 分钟', due_date: '2026-08-01' },
    { id: 505, project_id: 1, title: '合规审计对账口径不一致', description: '新会计准则与财务现有报表口径有差异', category: 'compliance', probability: 3, impact: 4, score: 12, status: 'mitigating', owner_id: 3, mitigation_plan: '建立口径映射表 + 双轨运行 1 个月', contingency_plan: '事务所外聘咨询', due_date: '2026-08-20' },
    { id: 506, project_id: 3, title: '运营团队培训不足', description: '新平台运营不熟练', category: 'resource', probability: 4, impact: 2, score: 8, status: 'identified', owner_id: 2, mitigation_plan: '上线前 2 周集中培训 + SOP 文档', due_date: '2026-07-20' },
    { id: 507, project_id: 4, title: '等保测评档期紧张', description: '测评机构档期通常到 Q4', category: 'schedule', probability: 4, impact: 3, score: 12, status: 'identified', owner_id: 3, mitigation_plan: '提前 1 个月预定测评机构', due_date: '2026-08-15' },
    { id: 508, project_id: 5, title: '客户方需求变更频繁', description: 'B 端客户常追加需求', category: 'scope', probability: 4, impact: 3, score: 12, status: 'identified', owner_id: 1, mitigation_plan: '需求冻结日 + 变更评审委员会', contingency_plan: '按基线交付 + 后续版本迭代', due_date: '2026-08-30' }
  ];

  const comments = [
    { id: 7001, target_type: 'task', target_id: 1003, parent_id: null, content: '幂等设计我明天给个方案，今天被 ERP 接口反复重试阻塞了 @刘洋', mentions: [5], attachments: [], ai_summary: null, ai_action_items: null, edited_at: null, is_deleted: false, created_by: 3, created_at: '2026-06-29T10:15:00' },
    { id: 7002, target_type: 'task', target_id: 1003, parent_id: 7001, content: '收到，我下午把 UUID idempotency-key 的 PR 先发你', mentions: [3], attachments: [], ai_summary: null, ai_action_items: null, edited_at: null, is_deleted: false, created_by: 5, created_at: '2026-06-29T11:00:00' },
    { id: 7003, target_type: 'task', target_id: 1003, parent_id: null, content: '附上相关历史事故：PRJ-2024-Q4-002 因为幂等问题出现过 80w 重复支付，建议本次直接上 Redis + idempotency-key 双保险。附件：复盘报告.pdf', mentions: [5], attachments: [{ name: '复盘报告.pdf', size: '1.2 MB' }], ai_summary: null, ai_action_items: null, edited_at: null, is_deleted: false, created_by: 1, created_at: '2026-06-29T14:30:00' },
    { id: 7004, target_type: 'task', target_id: 1001, parent_id: null, content: '进度同步：今日完成 5/9 h，明天继续 ETL 解析逻辑这块', mentions: [], attachments: [], ai_summary: null, ai_action_items: null, edited_at: null, is_deleted: false, created_by: 5, created_at: '2026-06-29T18:00:00' },
    { id: 7005, target_type: 'meeting', target_id: 888, parent_id: null, content: '【会议纪要】6/29 财务对账系统进度同步会\n\n参会：张伟、李军、王芳、刘洋、陈敏\n纪要：本周完成业务蓝图评审，阻塞任务 #1003 已与 ERP 接口方对齐，@刘洋 明天发幂等方案 PR。预计 UAT 提前 3 天。', mentions: [5], attachments: [{ name: '会议录音.m4a', size: '12 MB' }], ai_summary: '本次会议聚焦财务对账系统 M2 阶段进展。关键结论：① 业务蓝图已签字，进入开发快车道；② ERP 接口幂等性问题已识别解决方案；③ UAT 时间有望前置。', ai_action_items: [{ text: '刘洋提交幂等性设计 PR', owner: '刘洋', due: '2026-06-30', priority: 'P0' }, { text: '王芳协调 ERP 接口方回滚预案', owner: '王芳', due: '2026-07-02', priority: 'P1' }], edited_at: null, is_deleted: false, created_by: 3, created_at: '2026-06-29T17:00:00' }
  ];

  const meetings = [
    { id: 888, project_id: 1, title: '财务对账系统进度同步会', date: '2026-06-29', duration_min: 60, participants: [3, 5, 1, 6], transcript_length: 4200, transcript: '今天开进度同步会。王芳先说一下当前状态？\n……好的，里程碑 2 预付款模块进度 62%，但任务 #1003 幂等性设计被阻塞，需要 @刘洋 配合 ERP 接口方对方案。\n@刘洋 你明天能提交一份 idempotency-key 的 PR 吗？\n收到，我下午准备。\n会议上大家有没有其他风险？\n我担心的是 12 业务线蓝图签字延迟，建议 PMO 介入。\n同意，我会催办。\n那预计 UAT 可以提前 3 天。\n……', summary: { short: '聚焦里程碑 2 进展与阻塞', long: '本次会议讨论了财务对账系统 M2 阶段的关键路径，明确了 #1003 阻塞任务的解决方案，并就 UAT 时间表达成共识。', decisions: [{ text: '采用 UUID idempotency-key + Redis 去重双保险', owner: '刘洋', due: '2026-06-30' }, { text: 'PMO 介入催办 12 业务线签字', owner: '张伟', due: '2026-07-02' }], action_items: [{ text: '幂等性设计 PR', owner: '刘洋', priority: 'P0', due: '2026-06-30' }, { text: 'ERP 接口方回滚预案', owner: '王芳', priority: 'P1', due: '2026-07-02' }, { text: 'UAT 测试用例评审', owner: '陈敏', priority: 'P1', due: '2026-07-10' }], risks: [{ text: 'ERP 接口幂等性未上线前存在重复支付风险', level: 'high' }], open_questions: ['UAT 提前 3 天是否需要 PMO 审批？'] } }
  ];


  /* ============================================================
   * AI 侧数据（AIPM 集成）—— 待确认队列 / 审计日志 / 候选风险
   * ============================================================ */
  const pendingActions = [
    {
      id: 'act_1001',
      command: 'batch_update_tasks',
      title: '批量顺延本周 P0 任务截止日',
      args: { filter: { priorities: ['P0'], due_before: '2026-07-04' }, set: { due_date: '2026-07-13' } },
      hits: [
        { title: '对账引擎 V2 性能压测', from: '2026-07-02', to: '2026-07-13', owner: '赵磊', milestone: '对账自动化' },
        { title: 'SSO IdP 集群扩容', from: '2026-07-03', to: '2026-07-13', owner: '刘洋', milestone: 'IdP 搭建' },
        { title: '开票流水冲销联调', from: '2026-07-01', to: '2026-07-13', owner: '陈敏', milestone: '开票模块' }
      ],
      warning: '顺延后仍无法解锁关键路径：「合规审批材料补充」为外部依赖，需单独推动',
      status: 'pending',
      expires_at: '2026-07-01T10:30',
      created_by: 'AI',
      reason: '用户指令：把本周所有 P0 任务的截止日顺延到下周一'
    },
    {
      id: 'act_1002',
      command: 'update_risk',
      title: '风险等级升级：中 → 高',
      args: { risk_id: 302, probability: 4, impact: 3 },
      hits: [
        { title: '合规审批周期不可控', from: '概率中×影响高', to: '概率高×影响高', owner: '李军', milestone: '预付款模块' }
      ],
      warning: '升级后 score 12 → 等级「高」，将推送至项目负责人',
      status: 'pending',
      expires_at: '2026-07-01T10:30',
      created_by: 'AI',
      reason: '用户指令：R2 那条风险的等级也升到高'
    }
  ];

  const auditLogs = [
    { id: 'a1', time: '07-01 09:42', actor: 'AI', actor_name: 'AI 助理', command: 'split_task',
      summary: '「对账引擎 V2 性能压测」拆为「压测环境搭建」「基准测试执行」', undoable: true, undo_of: null },
    { id: 'a2', time: '07-01 09:41', actor: 'AI', actor_name: 'AI 助理', command: 'get_milestone_status',
      summary: '查询「预付款模块」状态 → 完成度 42%，存在阻塞 2 项', undoable: false, undo_of: null },
    { id: 'a3', time: '06-30 18:12', actor: 'USER', actor_name: '张伟', command: 'update_task',
      summary: '「SSO IdP 集群扩容」截止日 2026-07-03 → 2026-07-06', undoable: true, undo_of: null },
    { id: 'a4', time: '06-30 17:55', actor: 'AI', actor_name: 'AI 助理', command: 'create_task',
      summary: '新建任务「合规审批材料补充」（AI 创建）', undoable: true, undo_of: null },
    { id: 'a5', time: '06-30 15:20', actor: 'AI', actor_name: 'AI 助理', command: 'update_milestone',
      summary: '「IdP 搭建」截止日 → 2026-07-20（AI 建议，人工采纳）', undoable: true, undo_of: null }
  ];

  const riskSuggestions = [
    { id: 's1', category: '范围蔓延', level: '中', title: '新增需求估时超原计划 28%',
      detail: '本周新增 4 条需求共 34h，原计划余量 26h', action: '拆分优先级或申请延期' },
    { id: 's2', category: '过载', level: '高', title: '赵磊的 WIP 超过历史 P75',
      detail: '赵磊当前 6 项在办，历史 P75 为 4 项', action: '重新分配 2 项给陈敏' },
    { id: 's3', category: '阻塞', level: '高', title: '阻塞时长超均值 1.5×',
      detail: '「合规审批材料补充」已阻塞 5 天，历史均值 3.2 天', action: '升级至发起人或改走外部依赖流程' },
    { id: 's4', category: '流失', level: '低', title: '刘洋 8 天未更新任务',
      detail: '刘洋名下 3 个任务最近更新于 8 天前', action: '确认是否需要换人或减负' },
    { id: 's5', category: '延期', level: '高', title: '「预付款模块」预计延期 6 天',
      detail: '按当前速度与 CPM 关键路径推算', action: '拆分里程碑，先保 7-20 内部演示' }
  ];

  window.MOCK = { users, projects, milestones, tasks, risks, comments, meetings, pendingActions, auditLogs, riskSuggestions };
})();
