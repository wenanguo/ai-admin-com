# 06 · 外部 API 适配层契约

> 模块① 的内部契约。**外部 API 具体是哪一个尚未确定**（见 07 Q10），本文档定义的是**不依赖具体 API 的那部分**。

## 1. `DataSource` 接口

```ts
interface DataSource {
  // 项目
  listProjects(q: ProjectQuery): Promise<Project[]>;
  getProject(key: EntityKey): Promise<Project | null>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(key: EntityKey, patch: ProjectPatch): Promise<Project>;

  // 里程碑
  listMilestones(projectKey: EntityKey): Promise<Milestone[]>;
  getMilestone(key: EntityKey): Promise<Milestone | null>;
  createMilestone(input: MilestoneInput): Promise<Milestone>;
  updateMilestone(key: EntityKey, patch: MilestonePatch): Promise<Milestone>;
  deleteMilestone?(key: EntityKey): Promise<void>;         // 可选能力

  // 任务
  listTasks(q: TaskQuery): Promise<Task[]>;
  getTask(key: EntityKey): Promise<Task | null>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(key: EntityKey, patch: TaskPatch): Promise<Task>;
  deleteTask?(key: EntityKey): Promise<void>;               // 可选能力
  transitionTask(key: EntityKey, event: TaskEvent, reason?: string): Promise<Task>;

  // 批量
  batchUpdateTasks(q: TaskQuery, set: TaskPatch): Promise<BatchResult>;  // 可选能力

  // 依赖
  addDependency(taskKey: EntityKey, dependsOnKey: EntityKey, type?: DepType): Promise<void>;
  removeDependency?(dependencyKey: EntityKey): Promise<void>;            // 可选能力

  // 风险
  listRisks(q: RiskQuery): Promise<Risk[]>;
  getRisk(key: EntityKey): Promise<Risk | null>;
  createRisk(input: RiskInput): Promise<Risk>;
  updateRisk(key: EntityKey, patch: RiskPatch): Promise<Risk>;

  // 通用
  search(query: string, types?: EntityType[]): Promise<SearchHit[]>;
}
```

**规则**
- 所有 `key` 都是**统一领域模型的主键**（内部稳定标识），由适配层负责与外部 ID 互转（`EntityRef`）。
- 返回的实体**已经是统一领域模型**（枚举已归一、缺失字段已补默认）。
- 可选方法（`?`）不存在时，调用方按 `capabilities` 降级（§3）。
- `EntityKey` 建议直接用外部 ID 的稳定包装（如 `ext:12345`），避免额外映射表；只有当外部 ID 不稳定（删除重建会换 ID）时才需要 `EntityRef` 映射。

## 2. 写前快照装饰器

所有写操作统一经过一个装饰器，保证 INV-07 与 INV-15：

```ts
async function withSnapshot<T>(
  source: DataSource,
  command: string,
  target: { type: EntityType; key: EntityKey },
  mutate: () => Promise<T>,
): Promise<{ result: T; before: Snapshot; after: Snapshot }> {
  const before = await snapshotOf(source, target);   // 写前 GET，存旧值
  const result = await mutate();                      // 执行
  const after = await snapshotOf(source, target);
  await audit.write({ command, before, after });       // 同事务
  return { result, before, after };
}
```

- `before`/`after` 只存**字段级差异**（被改字段的旧值/新值），不存全量对象。
- 批量操作：**先全部读快照，再全部执行**，避免边写边读导致快照不一致。

## 3. 能力位（Capabilities）

外部 API 能力差异很大，用能力位显式声明，调用方按能力降级而不是靠 try/catch 猜。

```ts
interface Capabilities {
  supportsDelete: boolean;          // 能否真删
  supportsBatchUpdate: boolean;     // 能否批量
  supportsHistory: boolean;         // 能否查历史版本/ETag → 撤销优先用它
  supportsCustomFields: boolean;    // 能否存 extra_fields
  supportsDependencyGraph: boolean; // 能否建任务依赖
  supportsComments: boolean;
  maxBatchSize: number;             // 批量上限
  rateLimitPerMinute: number;
}
```

**降级矩阵**

| 能力缺失 | 降级做法 |
|---|---|
| 无 `supportsDelete` | 撤销时本地标记"逻辑删除"，不显示；不调用外部删除 |
| 无 `supportsBatchUpdate` | 适配层内循环 + 限流 + **逐条结果**（部分失败要报告） |
| 无 `supportsHistory` | 撤销走补偿式（写前快照反向写入） |
| 无 `supportsDependencyGraph` | 依赖信息降级为任务描述里的文本标注；`add_task_dependency` 返回明确错误 |
| 无 `supportsComments` | 评论功能隐藏，相关命令不注册 |

## 4. 枚举映射配置

映射写成**配置**而非硬编码，便于适配不同外部系统：

```yaml
# config/adapter/<system>.yml
task:
  status:
    todo:        ["To Do", "待办", "open"]
    in_progress: ["In Progress", "进行中", "doing"]
    in_review:   ["In Review", "待评审"]
    done:        ["Done", "已完成", "closed", "resolved"]
    blocked:     ["Blocked", "阻塞"]
    cancelled:   ["Cancelled", "已取消"]
  priority:
    P0: ["P0", "Critical", "紧急"]
    P1: ["P1", "High"]
    P2: ["P2", "Medium", "Normal"]
    P3: ["P3", "Low", "Minor"]
milestone:
  status:
    upcoming:    ["Planned", "计划中", "not_started"]
    in_progress: ["In Progress", "进行中", "started"]
    done:        ["Completed", "已完成", "done"]
risk:
  status:
    identified: ["Open", "开放", "identified"]
    analyzing:  ["Analyzing", "分析中"]
    mitigating: ["Mitigating", "应对中"]
    closed:     ["Closed", "已关闭"]
```

**规则**
- 第一个匹配的外部值胜出。
- 外部值没命中任何映射 → 归一为该字段的**默认状态**并记一条告警（不猜测语义）。
- 映射是**双向**的：写回时取第一个外部值。

## 5. 错误归一

```ts
type AdapterError =
  | { kind: "NOT_FOUND" }
  | { kind: "CONFLICT"; message?: string }
  | { kind: "VALIDATION"; fields?: Record<string, string> }
  | { kind: "RATE_LIMIT"; retryAfterMs?: number }
  | { kind: "AUTH_EXPIRED" }
  | { kind: "UNSUPPORTED"; capability: string }
  | { kind: "UPSTREAM"; message: string; retryable: boolean };
```

- 外部错误码 → 上述 kind 的映射写在适配器里。
- **`retryable: true` 的错误才允许重试**（读操作重试 1 次；写操作不自动重试，除非适配层确认幂等并带 `Idempotency-Key`）。
- `UPSTREAM` 且 `retryable: false` → 直接向用户报原文，不让模型反复试。

## 6. 幂等

- 所有创建类操作带 `Idempotency-Key`（由后端生成，`command + userId + 请求序号` 的哈希）。
- 适配层在重试时复用同一个 key，外部系统据此去重。
- 本地 `PendingAction` 的 `confirm` 接口对同一 `actionId` 幂等——重复点击只执行一次（用 `PendingAction.status` 的状态机保证：只有 `PENDING` 能转 `EXECUTED`）。

## 7. 限流

- 适配层内置令牌桶，按 `Capabilities.rateLimitPerMinute` 限速。
- 命中限流 → 返回 `RATE_LIMIT` + `retryAfterMs`，工具失败，模型转达给用户。
- **写操作不自动重试**——避免在用户不知情的情况下重复写入。

## 8. 适配器实现清单（接一个新外部 API 时要写的东西）

1. `ExternalPmClient`：认证、请求封装、错误映射、分页。
2. 枚举映射配置（§4）。
3. `DataSource` 实现：把外部字段翻译成统一领域模型（02 §2）。
4. `capabilities` 声明（§3）。
5. 写前快照实现（§2）。
6. 契约测试：对一个**固定的 mock 服务**跑一遍统一用例，断言统一领域模型的输出与枚举归一正确。

> 第 6 条是重点：**适配层必须用契约测试锁死**，否则换外部系统时行为漂移没人发现。契约用例集放在 `tests/contract/`，对每个适配器实现跑同一套。
