# Skills 层实现计划（阶段 2：业务同学写 markdown 就能加能力）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 服务能加载「技能（SKILL.md）」并按需读取它 ⇒ **加一条能力 = 加一个 markdown 文件，不需要改任何 TypeScript**。

**Architecture:** 复用 pi 的官方技能发现（`DefaultResourceLoader` 的 skills + `getSkills()`），但**自己渲染提示词段**（官方措辞只会说「用 read/bash 工具加载」，而我们没有那两个工具）；配套一个自定义工具 `load_skill`，按**名字**（可选相对路径）读取技能文件，路径白名单锁在技能目录内。

**Tech Stack:** pi SDK `@earendil-works/pi-coding-agent` 1.5.0（`loadSkillsFromDir` / `DefaultResourceLoader.getSkills()`）、typebox、vitest

**Spec:** `docs/superpowers/specs/2026-11-06-aipm-mcp-skills-design.md`（§2 目标、§3 约束、§6.3 技能、§8 阶段 2）

## Global Constraints

- **只用 pi 官方扩展点**：技能用 Agent Skills 规范（`SKILL.md` + frontmatter），工具用 `customTools`。不得自创解析器或运行时机制。
- **绝不放开 pi 的 `read` / `bash` 工具**：`noTools: "builtin"` 保持不变（我们的进程持有 `.env` 与数据库口令，模型不许读任意文件）。
- **技能只按名字读取**：模型传的是技能名（+ 可选的技能目录内相对路径），**不是任意路径**；越界一律拒绝。
- **提示词段自己渲染**：不调用 `formatSkillsForPrompt`（它的措辞只有 read/bash 两档）；格式照 Agent Skills 规范的 XML。
- **技能列表只来自 pi 的 loader**：`resourceLoader.getSkills().skills`。不得自己再扫一遍目录（否则与 pi 的去重/诊断不一致）。
- 仓内风格：TypeScript、**tab 缩进**、中文注释解释「为什么」；提交信息用 conventional commits（`feat(ai): …`）。
- 验证命令：`npx vitest run`（全部）与 `npx tsc --noEmit`（必须无输出）。

## Review Focus

规格暗示、但没有哪条任务会自然覆盖的失败模式（每条都要有对应的测试）：

1. **技能目录为空 / 没有技能** ⇒ 提示词里**不能**出现空的 `<available_skills>` 段（模型会去加载不存在的技能）。
2. **同名技能**（两个目录同名）⇒ pi loader 保留第一个并告警；我们的提示词必须**只呈现 loader 给的那一个**（不能自己再扫一遍目录）。
3. **技能文件读不到**（权限/编码/已被删）⇒ `load_skill` 要失败得**人话**，不能把堆栈或绝对路径糊给模型。
4. **技能里的附属文件**（Agent Skills 允许 `references/`、`scripts/`）⇒ `load_skill` 要能读**技能目录内**的相对路径；越界（`../`、绝对路径）必须拒绝。
5. **技能文件过大** ⇒ 读进上下文的东西要有上限（默认 64 KB），超了截断并**告诉模型被截断了**（否则模型会以为自己读全了）。

---

### Task 1: 技能提示词段

**Files:**
- Create: `src/agent/skills.ts`
- Test: `src/agent/skills.test.ts`

**Interfaces:**
- Consumes: pi 的 `Skill` 类型（`@earendil-works/pi-coding-agent` 导出：`{name, description, filePath, baseDir, sourceInfo, disableModelInvocation}`）
- Produces:
  ```ts
  export function renderSkillsSection(skills: readonly Skill[]): string;
  export function buildSystemPrompt(base: string, skills: readonly Skill[]): string;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/agent/skills.test.ts
import { describe, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt, renderSkillsSection } from "./skills";

/** 造一个技能条目（只填我们用到的字段）。 */
function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "create-task",
    description: "在 AiAdmin 里建任务。",
    filePath: "/repo/.pi/skills/create-task/SKILL.md",
    baseDir: "/repo/.pi/skills/create-task",
    disableModelInvocation: false,
    ...overrides,
  } as Skill;
}

describe("技能提示词段", () => {
  it("有技能时给出 <available_skills> 与 name/description/location", () => {
    const section = renderSkillsSection([skill()]);
    expect(section).toContain("<available_skills>");
    expect(section).toContain("<name>create-task</name>");
    expect(section).toContain("<description>在 AiAdmin 里建任务。</description>");
    expect(section).toContain("<location>/repo/.pi/skills/create-task/SKILL.md</location>");
  });

  it("提示词里说清用 load_skill 工具加载（不是 read/bash）", () => {
    expect(renderSkillsSection([skill()])).toContain("load_skill");
  });

  it("没有技能 ⇒ 空串（提示词里不留空段）", () => {
    expect(renderSkillsSection([])).toBe("");
  });

  it("disableModelInvocation 的技能不进提示词", () => {
    expect(renderSkillsSection([skill({ disableModelInvocation: true })])).toBe("");
  });

  it("buildSystemPrompt 把技能段接在 base 后面", () => {
    const prompt = buildSystemPrompt("你是助手。", [skill()]);
    expect(prompt.startsWith("你是助手。")).toBe(true);
    expect(prompt).toContain("<available_skills>");
  });

  it("没有技能时 buildSystemPrompt 原样返回 base", () => {
    expect(buildSystemPrompt("你是助手。", [])).toBe("你是助手。");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/skills.test.ts`
Expected: FAIL —— `Cannot find module './skills'`

- [ ] **Step 3: 实现 `src/agent/skills.ts`**

```ts
/**
 * 技能提示词段 —— 把 pi 发现的技能（SKILL.md）渲染进系统提示词。
 *
 * ## 为什么自己渲染，不直接用 pi 的 `formatSkillsForPrompt`
 *
 * pi 只在模型声明了 `read` 或 `bash` 工具时才把技能段写进系统提示
 * （`dist/core/system-prompt.js`）⇒ 我们的措辞必须是「用 `load_skill` 工具加载」。
 * pi 的 `formatSkillsForPrompt` 的 `fileReadTool` 只有 read / bash / 笼统一档 ⇒ 不用它。
 *
 * ## 格式
 *
 * 照 Agent Skills 规范的 XML（与 pi 的输出一致），便于别的 Agent 宿主复用。
 */
import type { Skill } from "@earendil-works/pi-coding-agent";

/** XML 转义（与 pi 的实现一致）。 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 渲染技能提示词段；没有可见技能时返回空串。 */
export function renderSkillsSection(skills: readonly Skill[]): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) {
    return "";
  }
  const lines = [
    "",
    "The following skills provide specialized instructions for specific tasks.",
    "Use the load_skill tool to load a skill's file when the task matches its description.",
    "Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.",
    "",
    "<available_skills>",
  ];
  for (const skill of visible) {
    lines.push(
      "  <skill>",
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.filePath)}</location>`,
      "  </skill>",
    );
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

/** 把技能段接到系统提示词后面。 */
export function buildSystemPrompt(base: string, skills: readonly Skill[]): string {
  const section = renderSkillsSection(skills);
  return section.length === 0 ? base : `${base}\n${section}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/skills.test.ts`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add src/agent/skills.ts src/agent/skills.test.ts
git commit -m "feat(ai): 技能提示词段（自己渲染,措辞指向 load_skill）"
```

---

### Task 2: `load_skill` 工具（受限读取）

**Files:**
- Create: `src/agent/skill-tools.ts`
- Test: `src/agent/skill-tools.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Skill` 类型来源（pi 导出）；`CommandTool`（`src/tools/types.ts`）
- Produces:
  ```ts
  export const LOAD_SKILL_TOOL_NAME = "load_skill";
  export const LoadSkillParameters = Type.Object({
    name: Type.String({ description: "技能名（available_skills 里列出的 name）" }),
    path: Type.Optional(Type.String({ description: "技能目录内的相对路径（读附属文件时用），缺省读 SKILL.md" })),
  });
  export function createLoadSkillTool(skills: readonly Skill[]): CommandTool<typeof LoadSkillParameters>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/agent/skill-tools.test.ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { createLoadSkillTool, LOAD_SKILL_TOOL_NAME } from "./skill-tools";

/** 造一个技能目录（SKILL.md + 一个附属文件）。 */
function makeSkill(): Skill {
  const baseDir = mkdtempSync(join(tmpdir(), "skill-"));
  mkdirSync(join(baseDir, "references"));
  writeFileSync(join(baseDir, "SKILL.md"), "# 建任务\n\n先查项目。\n", "utf8");
  writeFileSync(join(baseDir, "references", "fields.md"), "字段说明：project_key。\n", "utf8");
  return {
    name: "create-task",
    description: "在 AiAdmin 里建任务。",
    filePath: join(baseDir, "SKILL.md"),
    baseDir,
    disableModelInvocation: false,
  } as Skill;
}

/** 从工具结果里取文本。 */
function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

describe("load_skill 工具", () => {
  it("按名字读到 SKILL.md 全文", async () => {
    const tool = createLoadSkillTool([makeSkill()]);
    const result = await tool.execute("call-1", { name: "create-task" });
    expect(textOf(result)).toContain("# 建任务");
    expect(result.isError).toBeFalsy();
  });

  it("能读技能目录内的附属文件（相对路径）", async () => {
    const tool = createLoadSkillTool([makeSkill()]);
    const result = await tool.execute("call-1", {
      name: "create-task",
      path: "references/fields.md",
    });
    expect(textOf(result)).toContain("字段说明");
  });

  it("越界的相对路径被拒绝（../ 逃出技能目录）", async () => {
    const tool = createLoadSkillTool([makeSkill()]);
    const result = await tool.execute("call-1", {
      name: "create-task",
      path: "../../../etc/passwd",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain("root:");
  });

  it("名字不存在 ⇒ 失败并列出可用技能", async () => {
    const tool = createLoadSkillTool([makeSkill()]);
    const result = await tool.execute("call-1", { name: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("create-task");
  });

  it("文件读不到 ⇒ 失败得是人话，不带堆栈", async () => {
    const skill = makeSkill();
    const tool = createLoadSkillTool([skill]);
    const broken = { ...skill, filePath: join(skill.baseDir, "gone.md") } as Skill;
    const brokenTool = createLoadSkillTool([broken]);
    const result = await brokenTool.execute("call-1", { name: "create-task" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain("at Object");
  });

  it("工具名是 load_skill", () => {
    expect(LOAD_SKILL_TOOL_NAME).toBe("load_skill");
    expect(createLoadSkillTool([]).name).toBe("load_skill");
  });

  it("文件过大 ⇒ 截断并**告诉模型被截断了**", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "skill-big-"));
    writeFileSync(join(baseDir, "SKILL.md"), "x".repeat(70 * 1024), "utf8");
    const skill = {
      name: "big",
      description: "很大的技能。",
      filePath: join(baseDir, "SKILL.md"),
      baseDir,
      disableModelInvocation: false,
    } as Skill;
    const tool = createLoadSkillTool([skill]);
    const result = await tool.execute("call-1", { name: "big" });
    expect(textOf(result)).toContain("已截断");
    expect(textOf(result).length).toBeLessThan(70 * 1024);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/skill-tools.test.ts`
Expected: FAIL —— `Cannot find module './skill-tools'`

- [ ] **Step 3: 实现 `src/agent/skill-tools.ts`**

```ts
/**
 * `load_skill` —— 让模型按名字加载技能文件（SKILL.md 及其附属文件）。
 *
 * ## 为什么自己做一个工具，而不是放开 pi 的 `read`
 *
 * 我们的进程持有 `.env`（模型 key）与数据库口令 ⇒ 放开 `read` 等于把整个仓库
 * 与密钥交给模型。而技能文件是**我们自己放进去的、公开的配方** ⇒ 只读它们。
 *
 * ## 越界防护
 *
 * 模型只传**技能名**（+ 可选的相对路径）⇒ 绝对路径由我们从技能表里查出来，
 * 模型碰不到。相对路径要落在**该技能的目录内**（`../` 一律拒绝）。
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CommandTool } from "../tools/types";

/** 工具名（模型用它调用）。 */
export const LOAD_SKILL_TOOL_NAME = "load_skill";

/** 读一个技能文件的大小上限（字节）。 */
export const MAX_SKILL_BYTES = 64 * 1024;

/** 参数 schema。 */
export const LoadSkillParameters = Type.Object({
  name: Type.String({
    description: "技能名（available_skills 里列出的 name）",
  }),
  path: Type.Optional(
    Type.String({
      description: "技能目录内的相对路径（读附属文件时用）；缺省读 SKILL.md",
    }),
  ),
});

/** 造一个失败结果（不抛异常 ⇒ 模型看到的是一段可读的说明）。 */
function failure(message: string): {
  content: { type: "text"; text: string }[];
  details: { ok: false };
  isError: true;
} {
  return { content: [{ type: "text", text: message }], details: { ok: false }, isError: true };
}

/** 造一个成功结果。 */
function success(text: string): {
  content: { type: "text"; text: string }[];
  details: { ok: true };
} {
  return { content: [{ type: "text", text }], details: { ok: true } };
}

/** 这个相对路径有没有落在 baseDir 之内。 */
function inside(baseDir: string, target: string): boolean {
  const root = resolve(baseDir) + sep;
  return resolve(target).startsWith(root);
}

/**
 * 造 `load_skill` 工具。
 *
 * @param skills pi 发现的技能（名字 → 文件位置）。
 */
export function createLoadSkillTool(skills: readonly Skill[]): CommandTool<typeof LoadSkillParameters> {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return {
    name: LOAD_SKILL_TOOL_NAME,
    label: "加载技能",
    description:
      "加载一个技能（SKILL.md）的完整说明。技能名在系统提示的 available_skills 里。" +
      "当任务与某个技能的描述吻合时，先加载它再动手。",
    parameters: LoadSkillParameters,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    execute: async (_toolCallId, params) => {
      const skill = byName.get(params.name);
      if (skill === undefined) {
        const available = [...byName.keys()].join("、") || "（一个都没有）";
        return failure(`没有叫「${params.name}」的技能。可用的技能：${available}`);
      }
      const target =
        params.path === undefined
          ? skill.filePath
          : resolve(join(skill.baseDir, params.path));
      if (!inside(skill.baseDir, target)) {
        return failure(`「${params.path}」不在技能 ${skill.name} 的目录里，读不了。`);
      }
      let raw: string;
      try {
        raw = readFileSync(target, "utf8");
      } catch {
        return failure(`读不到技能文件（${skill.name}）。`);
      }
      if (Buffer.byteLength(raw, "utf8") > MAX_SKILL_BYTES) {
        const truncated = Buffer.from(raw, "utf8").subarray(0, MAX_SKILL_BYTES).toString("utf8");
        return success(`${truncated}\n\n（内容过长，已截断。）`);
      }
      return success(raw);
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/skill-tools.test.ts`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add src/agent/skill-tools.ts src/agent/skill-tools.test.ts
git commit -m "feat(ai): load_skill 工具（按名字读技能,目录内白名单）"
```

---

### Task 3: 接进 pi 会话

**Files:**
- Modify: `src/agent/pi-session.ts`（`DefaultResourceLoader` 的 `noSkills`、systemPrompt、customTools）
- Modify: `src/agent/prompt.ts`（能力清单改写）
- Modify: `src/agent/pi-session.test.ts`（SDK mock 要有 `getSkills()`）

**Interfaces:**
- Consumes: Task 1 的 `buildSystemPrompt(base, skills)`；Task 2 的 `createLoadSkillTool(skills)`
- Produces: `createPiSession` 的行为变化 —— 传给 SDK 的 `systemPrompt` 含技能段；`customTools` 含 `load_skill`

- [ ] **Step 1: 写失败测试（改 `src/agent/pi-session.test.ts`）**

在现有的 SDK mock 里给 `DefaultResourceLoader` 加上 `getSkills()`：

```ts
DefaultResourceLoader: class {
  constructor(public readonly options: unknown) {}
  async reload(): Promise<void> {}
  getSkills() {
    return {
      skills: [
        {
          name: "create-task",
          description: "在 AiAdmin 里建任务。",
          filePath: "/repo/.pi/skills/create-task/SKILL.md",
          baseDir: "/repo/.pi/skills/create-task",
          disableModelInvocation: false,
        },
      ],
      diagnostics: [],
    };
  }
},
```

新增用例：

```ts
it("把技能段拼进系统提示词", async () => {
  await createPiSession({
    tools: [fakeTool],
    systemPrompt: "你是助手。",
    conversationId: "conv-1",
    history: [],
    model: "minimax-cn/MiniMax-M3.1-Flash",
  });

  const options = vi.mocked(createAgentSession).mock.calls[0]?.[0];
  const loader = options?.resourceLoader as {
    options?: { systemPrompt?: string };
  };
  expect(loader.options?.systemPrompt).toContain("<available_skills>");
  expect(loader.options?.systemPrompt).toContain("<name>create-task</name>");
});

it("customTools 里含 load_skill", async () => {
  await createPiSession({
    tools: [fakeTool],
    systemPrompt: "你是助手。",
    conversationId: "conv-1",
    history: [],
    model: "minimax-cn/MiniMax-M3.1-Flash",
  });

  const options = vi.mocked(createAgentSession).mock.calls[0]?.[0];
  const names = (options?.customTools ?? []).map((tool) => tool.name);
  expect(names).toContain("load_skill");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/pi-session.test.ts`
Expected: FAIL —— 技能段没进 systemPrompt、customTools 里没有 `load_skill`

- [ ] **Step 3: 改 `src/agent/pi-session.ts`**

- `DefaultResourceLoader` 的选项里把 `noSkills: true` 改成 `noSkills: false`（**让 pi 去发现 `.pi/skills/`**；我们的安全策略不变：仍然不放开 read/bash 工具）。
- `await resourceLoader.reload()` 之后取技能：

```ts
const skills = resourceLoader.getSkills().skills;
```

- systemPrompt 改用 Task 1 的拼接：

```ts
systemPrompt: buildSystemPrompt(options.systemPrompt, skills),
```

- customTools 加上 Task 2 的工具：

```ts
customTools: [...options.tools, createLoadSkillTool(skills)],
```

- [ ] **Step 4: 改 `src/agent/prompt.ts`**

把「【你的能力】- 目前只有一个命令：create_task —— 在某个项目下新建一条任务。」
改成下面这段（**不能再说「只有一个命令」**，否则模型不知道自己还能用技能）：

```
【你的能力】
- 你的工具就是能力：建任务用 create_task。
- 另有一组「技能」（available_skills）：每个技能是一份写好的操作说明（markdown）。
  当任务与某个技能的描述吻合时，**先用 load_skill 加载它**，再按里面的步骤做。
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/agent/pi-session.test.ts`
Expected: PASS

- [ ] **Step 6: 全量验证**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS；tsc 无输出

- [ ] **Step 7: 提交**

```bash
git add src/agent/pi-session.ts src/agent/prompt.ts src/agent/pi-session.test.ts
git commit -m "feat(ai): pi 会话接上技能（发现 SKILL.md + 注入提示词 + load_skill）"
```

---

### Task 4: 三个样板技能

**Files:**
- Create: `.pi/skills/create-task/SKILL.md`
- Create: `.pi/skills/list-tasks/SKILL.md`
- Create: `.pi/skills/list-projects/SKILL.md`
- Modify: `src/agent/skills.test.ts`（加一组「样板能被加载」的用例）

**Interfaces:**
- Consumes: pi 的 `loadSkillsFromDir({dir, source})`（官方扫描器）
- Produces: 三个可被业务同学照抄的样板

- [ ] **Step 1: 写失败测试（加到 `src/agent/skills.test.ts` 末尾）**

```ts
describe("样板技能", () => {
  it("三个样板都能被 pi 的 loader 加载，且有 name 与 description", () => {
    const result = loadSkillsFromDir({
      dir: join(process.cwd(), ".pi", "skills"),
      source: "project",
    });
    const names = result.skills.map((skill) => skill.name).sort();
    expect(names).toEqual(["create-task", "list-projects", "list-tasks"]);
    for (const skill of result.skills) {
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeLessThanOrEqual(1024);
    }
  });

  it("同名技能 ⇒ loader 只留一个并给诊断（我们只信 loader，不自己再扫一遍）", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-dup-"));
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    writeFileSync(join(dir, "a", "SKILL.md"), "---\nname: same\ndescription: 甲\n---\n", "utf8");
    writeFileSync(join(dir, "b", "SKILL.md"), "---\nname: same\ndescription: 乙\n---\n", "utf8");

    const result = loadSkillsFromDir({ dir, source: "test" });
    expect(result.skills.filter((skill) => skill.name === "same")).toHaveLength(1);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
```

（文件顶部补 `import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";`、
`import { tmpdir } from "node:os";`、`import { join } from "node:path";` 与
`import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";`）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/skills.test.ts`
Expected: FAIL —— 技能列表为空（`expected [ 'create-task', 'list-projects', 'list-tasks' ]`）

- [ ] **Step 3: 写三个样板**

`.pi/skills/create-task/SKILL.md`：

```markdown
---
name: create-task
description: 在 AiAdmin 的项目下新建一条任务。用户说「建个任务」「加一条 XX 任务」「记一下要做的事」时用。
---

# 建任务

1. **先找项目**：用 `create_task` 的兄弟命令前，先用项目列表命令按编码找到项目
   （用户通常给的是编码，形如 `PRJ-2026-Q3-001`）。
   - 找不到 ⇒ **问用户**要编码，**绝不**自己编一个。
2. **建任务**：调用 `create_task`，参数：
   - `project_id` = 上一步找到的项目 id
   - `title` = 一句话，动宾结构，不超过 60 字
   - `created_via_code` = `nl_chat`（自然语言对话建的）
   - `reporter_id` = 当前登录用户的 id
   - 其它字段按用户的原话填，没说的不要瞎填
3. **回报**：告诉用户任务标题、所属项目、状态（新建后是 backlog）、以及任务 key。
```

`.pi/skills/list-tasks/SKILL.md`：

```markdown
---
name: list-tasks
description: 列出某个项目下的任务。用户问「这个项目还有哪些任务」「哪些任务没做完」时用。
---

# 列任务

1. 用户没给项目 ⇒ **先问**是哪个项目（编码形如 `PRJ-2026-Q3-001`），不要瞎猜。
2. 用项目列表命令按编码找到项目 id。
3. 用任务列表命令按项目 id 列出任务；用户指定了状态就按状态过滤。
4. **回报**：按状态分组列出（标题 + 状态 + 优先级），并说明一共多少条。
   - 后端单页上限 100 条 ⇒ 超过时要说明「只列了最新的一批」。
```

`.pi/skills/list-projects/SKILL.md`：

```markdown
---
name: list-projects
description: 列出 AiAdmin 里的项目。用户问「有哪些项目」「项目 X 在哪」时用。
---

# 列项目

1. 用项目列表命令列出项目（用户给了编码就按编码过滤）。
2. **回报**：项目名 + 编码 + 状态。
   - 一条都没列出来时，先确认是不是编码写错了，再问用户。
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/skills.test.ts`
Expected: PASS

- [ ] **Step 5: 手工验收（需要模型凭据，不进 CI）**

1. 起服务：`npm run dev`（端口 3100）
2. 用一个真实账号问：「帮我建一个 SSO 登录的任务」⇒ 观察 SSE 里有 `load_skill` 的调用记录（`tool_call` / `tool_result`）
3. 期望：模型先 `load_skill(create-task)`，再按技能里的步骤走

（这一步依赖模型与后端；失败时先看 `/api/agent/:cid/state` 的快照里有没有技能调用记录）

- [ ] **Step 6: 全量验证**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS；tsc 无输出

- [ ] **Step 7: 提交**

```bash
git add .pi/skills src/agent/skills.test.ts
git commit -m "feat(ai): 三个样板技能（建任务/列任务/列项目）"
```

---

## 不在本计划范围

- **MCP 接入**（设计文档 §8 阶段 1）：依赖后端部署（用户负责），另写计划。
- **待确认闭环**（§8 阶段 3）：依赖阶段 1 与 2，另写计划。
- **退休 adapter 与代码工具**（§8 阶段 4）：等 MCP 稳定后再做。
- **技能热加载**（改完 `/reload` 即生效）：第一版靠重启（设计文档 §9 的决定）。
