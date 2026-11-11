# 「与 AI 讨论」只切上下文 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点「与 AI 讨论」只把当前任务/项目设为讨论上下文，**不再替用户发任何命令**；用户自己说的下一句话才带上下文。

**Architecture:** 删掉前端「注入」这条链路 —— `ai-bridge` model 上的 `injectRequest/requestInject`、工作台里监听它的 effect、气泡上的「上下文」标记、以及那句固定提示词 `contextPromptText`。服务端不用改：它本来就给**每一条**用户消息带上 `context`（`backend/ai/src/agent/runtime.ts` 的 `renderAiTaskContext`）⇒ 用户的第一句真话就已经带着上下文。

**Tech Stack:** React 19、UmiJS Max 6、TypeScript、Vitest（browser 模式 + Playwright）、Biome。

**Spec:** `docs/superpowers/specs/2026-11-11-ai-discussion-context-only-design.md`

## Global Constraints

- 只改 `frontend/`。**后端与 AI 服务（`backend/ai/`）一行都不动** —— 服务端对上下文每条消息都带。
- 仓库根在 `/Users/ruanying/project/ai-admin-com`，前端在 `frontend/`（monorepo）。
- 全部改动落在 `frontend/`，命令一律在 `frontend/` 目录下跑。
- 注释用中文，且要写「**为什么**」，不写「做了什么」——与本仓现有风格一致。
- 提交信息用中文 conventional commits（例：`refactor(ai): 点「讨论」只切上下文，不再替用户发命令`）。
- ⚠️ 本机 `npx vitest run` 会报**两种**环境错误，**都不是代码问题**：
  1. `Executable doesn't exist at .../chrome-headless-shell` ⇒ 跑一次 `npx playwright install chromium-headless-shell`（已装好）。
  2. `No loader is configured for ".node" files: node_modules/fsevents/fsevents.node`
     （依赖预优化把 macOS 原生模块也扫进去了）。

  跑测试时用本地覆盖配置（**不要提交**）：

  ```bash
  cd frontend
  cat > vitest.local.config.ts <<'EOF'
  import { defineConfig, mergeConfig } from 'vitest/config';
  import base from './vitest.config';
  export default mergeConfig(base, defineConfig({ optimizeDeps: { exclude: ['fsevents'] } }));
  EOF
  npx vitest run --config vitest.local.config.ts <路径>
  ```

  跑完 `rm -f vitest.local.config.ts`。
- 收尾必须全绿：`npx tsc --noEmit`、`npx biome lint`、`npx vitest run --config vitest.local.config.ts`。

## Review Focus

规格暗示、但任何单个任务的测试都不会自动覆盖的五类输入 —— 每条都在下面指定的任务里补了对应测试。

1. **用户点了「讨论」但还没说话** ⇒ 不得有任何命令发出去（不调模型、不烧 token、不写 `ai_message`）。
   → Task 1 的「即使桥上还留着注入请求，工作台也不自己发命令」。
2. **用户随后自己说的第一句话** ⇒ 必须带上那个任务/项目的上下文，否则智能体不知道在聊谁（这是替掉「自动发一句」的关键）。
   → Task 1 的「用户自己说的那句话会带上当前上下文」。
3. **换一条任务再说话** ⇒ 上下文被**替换**（不是叠加、不是残留上一条）。
   → Task 1 的「换了上下文之后，下一条命令带的是新的那个」。
4. **刷新页面 / 历史恢复** ⇒ 库里旧的「已切换到…」消息（那时是 USER 行）现在按普通用户气泡渲染，**不得崩、不得丢**。
   → Task 3 的「用户气泡不再有「来源」概念」：`restore` 路径重建历史时不能因为没有 `origin` 而报错。
5. **AI 服务不可用时点「讨论」** ⇒ 不得因为「替用户发一句」而多出一次失败请求与一个报错气泡。
   → Task 1 的第一条测试已经覆盖（没有注入 ⇒ 没有任何请求发出去）。

---

### Task 1: 工作台不再监听「注入请求」

**Files:**
- Modify: `frontend/src/components/ai-workspace/useWorkspace.ts`（删注入 effect、`send` 的 `origin` 参数）
- Test: `frontend/src/components/ai-workspace/useWorkspace.test.ts`

**Interfaces:**
- Consumes: 现状 —— `useWorkspace()` 返回的 `send: (text: string) => Promise<void>`；模型 `ai-bridge` 上有 `context` / `injectRequest` / `requestExpand` / `requestFocus`。
- Produces: `useWorkspace()` 的 `send` 签名变成 `(text: string) => Promise<void>`（**不再有第二参**）。
  调用方 `frontend/src/components/ai-workspace/index.tsx` 与 `frontend/src/pages/ai/workspace/index.tsx` 已经是单参调用 ⇒ 无需改。

- [ ] **Step 1: 写失败测试（三个）**

  改 `frontend/src/components/ai-workspace/useWorkspace.test.ts` 的假 model —— 它现在每次渲染返回**新对象**，测试没法改它。改成**模块级稳定对象**：

  ```ts
  const mocks = vi.hoisted(() => ({
    // …已有的那些…
    /** 假的全局 model（AI 工作台 ↔ 主工作区的桥）。
     *  ⚠️ **必须稳定**：测试要改它的字段并重渲染 ⇒ 每次返回新对象就测不了。 */
    bridge: {
      context: null as unknown,
      setContext: vi.fn(),
      clearContext: vi.fn(),
      lastUpdate: null,
      notifyUpdate: vi.fn(),
      expandSignal: 0,
      focusSignal: 0,
      /** ⚠️ **故意保留**这个字段：真实模型里它马上要删掉了。
       *  留在这里是为了钉住「工作台不会因为它而自动发命令」。 */
      injectRequest: null as { text: string; at: number } | null,
      requestExpand: vi.fn(),
      requestFocus: vi.fn(),
      requestInject: vi.fn(),
    },
  }));
  ```

  然后把 `vi.mock('@umijs/max', ...)` 里的 `useModel: () => ({ ... })` 换成
  `useModel: () => mocks.bridge`（返回那一个稳定对象）。

  `beforeEach` 里补两行（防止用例之间串味 ⇒ **两个都要重置**）：

  ```ts
  mocks.bridge.context = null;
  mocks.bridge.injectRequest = null;   // ⚠️ 不重置的话，上一个用例留下的注入请求会打乱本用例的调用次序
  ```

  新增三个用例：

  a) **「即使桥上还留着注入请求，工作台也不自己发命令」**

  ```ts
  it('即使桥上还留着注入请求，工作台也不自己发命令', async () => {
    // ⚠️ `renderHook` 要 **await**（返回的 `act` 是它解构出来的，不是模块导出）
    const { result, rerender } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    // 模拟「有人请求替用户发一句」（今天点「讨论」正是这么干的）
    mocks.bridge.injectRequest = {
      text: '已切换到当前任务：#1 测试',
      at: Date.now(),
    };
    rerender();
    // ⚠️ 等一拍：今天这里会真的发出去（effect 立刻跑 send）
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mocks.sendAiCommand).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });
  ```

  b) **「用户自己说的那句话会带上当前上下文」**

  ```ts
  it('用户自己说的那句话会带上当前上下文', async () => {
    mocks.bridge.context = { kind: 'task', task: { id: 6, title: '测试333' } };
    const { result } = await renderHook(() => useWorkspace());

    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });
    await result.current.send('这个任务做完了吗');

    expect(mocks.sendAiCommand).toHaveBeenCalledWith(
      'c-new',
      '这个任务做完了吗',
      { id: 'cmd-1', context: mocks.bridge.context },
    );
  });
  ```

  c) **「换了上下文之后，下一条命令带的是新的那个」**

  ```ts
  it('换了上下文之后，下一条命令带的是新的那个', async () => {
    const { result } = await renderHook(() => useWorkspace());
    await vi.waitFor(() => {
      expect(result.current.conversationId).toBe('c-new');
    });

    mocks.bridge.context = { kind: 'task', task: { id: 6, title: '旧的' } };
    await result.current.send('第一条');
    mocks.bridge.context = { kind: 'task', task: { id: 7, title: '新的' } };
    await result.current.send('第二条');

    expect(mocks.sendAiCommand.mock.calls[0]?.[2]).toEqual({
      id: 'cmd-1',
      context: { kind: 'task', task: { id: 6, title: '旧的' } },
    });
    expect(mocks.sendAiCommand.mock.calls[1]?.[2]).toEqual({
      id: 'cmd-1',
      context: { kind: 'task', task: { id: 7, title: '新的' } },
    });
  });
  ```

- [ ] **Step 2: 跑测试，确认 a) 失败、b) c) 通过**

  ```bash
  cd frontend
  npx vitest run --config vitest.local.config.ts src/components/ai-workspace/useWorkspace.test.ts
  ```

  预期：**a) 失败**（今天 effect 真的把那条注入发出去了 ⇒ `sendAiCommand` 被调用了一次，
  参数是 `('c-new', '已切换到当前任务：#1 测试', { id: 'cmd-1' })`）；
  b) c) 通过（上下文本来就随每条消息带）。

  > 已实测：这三条按上面的写法写，今天 a) 确实是红的、b) c) 确实是绿的；
  > 改完 `useWorkspace.ts` 之后三条全绿。**注意 a) 必须 `await renderHook` 且改完
  > `mocks.bridge.injectRequest` 后要 `rerender()`** —— 不 rerender 的话 effect 不会重跑，a) 会假绿。

- [ ] **Step 3: 删掉工作台里的注入 effect**

  `frontend/src/components/ai-workspace/useWorkspace.ts`：

  - 删掉整个 effect：

    ```ts
    /**
     * 「代用户发一句上下文说明」—— 点了「与 AI 讨论」之后自动发。
     * …
     */
    useEffect(() => {
      const request = aiContext.injectRequest;
      if (!request) {
        return;
      }
      void send(request.text, 'context');
    }, [aiContext.injectRequest, send]);
    ```

  - `send` 的第二参 `origin` 删掉：

    ```ts
    const send = useCallback(
      async (text: string): Promise<void> => {
        // …
        appendUserMessage(trimmed);
        await submit(id, trimmed);
      },
      [appendUserMessage, submit],
    );
    ```

- [ ] **Step 4: 跑测试，确认三个都通过**

  ```bash
  cd frontend
  npx vitest run --config vitest.local.config.ts src/components/ai-workspace/useWorkspace.test.ts
  ```

  预期：全部通过（3 个新用例 + 原有 13 个）。

- [ ] **Step 5: 类型检查**

  ```bash
  cd frontend
  npx tsc --noEmit
  ```

  预期：无错误。
  （`useAgentStream` 的 `appendUserMessage` 目前还接受 `origin` ⇒ 多传一个参数**不报 TS 错**（可选参数），这一步不会红；Task 3 才彻底删掉 `origin`。）

- [ ] **Step 6: 提交**

  ```bash
  cd /Users/ruanying/project/ai-admin-com
  git add frontend/src/components/ai-workspace/useWorkspace.ts frontend/src/components/ai-workspace/useWorkspace.test.ts
  git commit -m "refactor(ai): 工作台不再替用户发上下文说明，只在用户自己说话时带上下文"
  ```

---

### Task 2: 桥上删掉「注入」入口，页面不再请求注入

**Files:**
- Modify: `frontend/src/models/ai-bridge.ts`（删 `injectRequest` / `requestInject` 及其注释）
- Modify: `frontend/src/components/pm/aiContext.ts`（删 `contextPromptText`）
- Modify: `frontend/src/pages/module_pm/task/index.tsx`
- Modify: `frontend/src/pages/module_pm/task/board.tsx`
- Modify: `frontend/src/pages/module_pm/task/gantt.tsx`
- Modify: `frontend/src/pages/module_pm/project/index.tsx`
- Modify: `frontend/src/pages/module_pm/project/detail.tsx`
- Modify: `frontend/src/components/ai-workspace/index.test.tsx`（假 model）
- Modify: `frontend/src/components/ai-workspace/AiWorkspaceShell.test.tsx`（假 model）
- Create: `frontend/src/models/ai-bridge.test.ts`

**Interfaces:**
- Consumes: Task 1 之后的 `useWorkspace().send(text)`（单参）。
- Produces: `useAiBridgeModel()` 的返回值**不再有** `injectRequest` / `requestInject`
  ⇒ 任何页面再想「替用户发一句」，**编译期就报错**。
  `AiContextModel` 里剩下的公开方法恰好是：`context` / `setContext` / `clearContext` /
  `lastUpdate` / `notifyUpdate` / `expandSignal` / `requestExpand` / `focusSignal` / `requestFocus`。

- [ ] **Step 1: 写失败测试（新建 `frontend/src/models/ai-bridge.test.ts`）**

  ```ts
  /**
   * AI 工作台 ↔ 主工作区的桥（全局 model）的测试。
   *
   * 钉死一件事：**桥上没有「替用户发一句」的入口**。
   *
   * ⚠️ 为什么钉它：点「与 AI 讨论」曾经会替用户发一条命令（真调模型）。
   *    那条链路一旦回来，用户没说话也会烧 token ⇒ 必须有测试拦着。
   *    顺带也钉住「桥只负责上下文与界面信号，不负责发消息」。
   */
  import { describe, expect, it } from 'vitest';
  import { renderHook } from 'vitest-browser-react';
  import type { AiTaskContext } from '@/services/api/ai/types';
  import useAiBridgeModel from './ai-bridge';

  describe('ai-bridge 模型', () => {
    it('没有替用户发消息的入口', async () => {
      const { result } = await renderHook(() => useAiBridgeModel());

      expect(Object.keys(result.current)).not.toContain('requestInject');
      expect(Object.keys(result.current)).not.toContain('injectRequest');
    });

    it('设了上下文就能读到，清掉就没了', async () => {
      // ⚠️ `act` 是 `renderHook` 返回的（**不是**从 'vitest-browser-react' 导入的）
      const { act, result } = await renderHook(() => useAiBridgeModel());
      const context: AiTaskContext = { kind: 'task', task: { id: 6, title: '测试333' } };

      act(() => {
        result.current.setContext(context);
      });
      expect(result.current.context).toEqual(context);

      act(() => {
        result.current.clearContext();
      });
      expect(result.current.context).toBeNull();
    });
  });
  ```

- [ ] **Step 2: 跑测试，确认第一个失败**

  ```bash
  cd frontend
  npx vitest run --config vitest.local.config.ts src/models/ai-bridge.test.ts
  ```

  预期：第一个用例**失败**（今天 model 上确实有 `requestInject` / `injectRequest`），
  第二个通过。已实测：报 `expected [ 'context', 'setContext', …(9) ] to not include 'requestInject'`。

- [ ] **Step 3: 五个页面不再请求注入**

  每个文件做**两件事**（其余一行不动）：

  1. 删掉这一行：

     ```ts
     // ⚠️ **替用户发一句上下文说明**：用户点「讨论」时并没有说话
     //    ⇒ 不发这句的话，智能体会接着上一句聊（用户看着像「点了没反应」）
     aiBridge.requestInject(contextPromptText(context));
     ```

     （`project/index.tsx` 与 `project/detail.tsx` 上面的注释措辞略不同，是同一行调用，同样删。）

  2. 从 `@/components/pm/aiContext` 的 import 里删掉 `contextPromptText`：

     ```ts
     import {
       buildAiTaskContext,
       mergeDictLabels,
     } from '@/components/pm/aiContext';
     ```

     （`project/index.tsx` / `project/detail.tsx` 那边是 `buildAiProjectContext`。）

  涉及文件与位置：
  - `frontend/src/pages/module_pm/task/index.tsx`（约 139 行）
  - `frontend/src/pages/module_pm/task/board.tsx`（约 183 行）
  - `frontend/src/pages/module_pm/task/gantt.tsx`（约 338 行）
  - `frontend/src/pages/module_pm/project/index.tsx`（约 96 行）
  - `frontend/src/pages/module_pm/project/detail.tsx`（约 461 行）

  > ⚠️ **顺序很重要**：这一步**必须在 Step 4 之前**。
  > 反过来（先删 model 的字段、再删页面的调用）中间会有一段 `tsc` 报 7 处
  > `Property 'requestInject' does not exist on type 'AiContextModel'` —— 已实测。

- [ ] **Step 4: 删掉 model 上的注入字段**

  `frontend/src/models/ai-bridge.ts`：

  - 删 `AiContextModel` 里的这两项（含那段「为什么要点一下就替用户发一句」的注释）：

    ```ts
    /**
     * 「请发一句上下文说明」的请求（点「与 AI 讨论」时调）。
     * …
     */
    injectRequest: { text: string; at: number } | null;
    requestInject: (text: string) => void;
    ```

  - 删实现里的 `injectRequest` state、`requestInject` useCallback、以及 return 里的两项。

- [ ] **Step 5: 删掉那句固定提示词**

  `frontend/src/components/pm/aiContext.ts`：删掉整个 `contextPromptText` 函数（含它的注释块）。
  保留 `contextSkillLabel`（**本任务不动它** —— 它本来就没有任何地方用，但删它与本次改动无关，混进来只会让 diff 变脏）。

- [ ] **Step 6: 修掉两个假 model**

  `frontend/src/components/ai-workspace/index.test.tsx` 与
  `frontend/src/components/ai-workspace/AiWorkspaceShell.test.tsx` 里，
  各自的 `vi.mock('@umijs/max', ...)` 中 `useModel: () => ({ ... })` 里
  **删掉** `injectRequest: null,` 与 `requestInject: vi.fn(),` 两行。
  （`useWorkspace.test.ts` 的那个**故意保留** —— 那是 Task 1 的护栏，别动。）

- [ ] **Step 7: 跑测试，确认全通过**

  ```bash
  cd frontend
  npx vitest run --config vitest.local.config.ts src/models/ai-bridge.test.ts src/components/ai-workspace
  ```

  预期：全绿（`ai-bridge.test.ts` 2 个 + `ai-workspace` 目录下的全部）。

- [ ] **Step 8: 类型检查 + lint**

  ```bash
  cd frontend
  npx tsc --noEmit
  npx biome lint
  ```

  预期：都无输出（无错误）。
  （`contextPromptText` 若还有残留引用，`tsc` 会报「没有导出成员」—— 这是本任务的主要护栏。）

- [ ] **Step 9: 提交**

  ```bash
  cd /Users/ruanying/project/ai-admin-com
  git add frontend/src/models/ai-bridge.ts frontend/src/models/ai-bridge.test.ts \
          frontend/src/components/pm/aiContext.ts \
          frontend/src/pages/module_pm/task/index.tsx frontend/src/pages/module_pm/task/board.tsx \
          frontend/src/pages/module_pm/task/gantt.tsx \
          frontend/src/pages/module_pm/project/index.tsx frontend/src/pages/module_pm/project/detail.tsx \
          frontend/src/components/ai-workspace/index.test.tsx frontend/src/components/ai-workspace/AiWorkspaceShell.test.tsx
  git commit -m "refactor(ai): 删掉「替用户发一句」的注入通道，点讨论只切上下文"
  ```

---

### Task 3: 清掉气泡上的「上下文」标记与 `origin` 字段

**Files:**
- Modify: `frontend/src/components/ai-workspace/useAgentStream.ts`
- Modify: `frontend/src/components/ai-workspace/MessageBubble.tsx`
- Test: `frontend/src/components/ai-workspace/useAgentStream.test.ts`

**Interfaces:**
- Consumes: Task 1 之后 `appendUserMessage(text)`（只传文本）。
- Produces: `ChatMessage` 上**不再有** `origin?: 'context'`；
  `createUserMessage(text)` 与 `appendUserMessage(text)` 都只接文本。

- [ ] **Step 1: 写「红」的护栏（类型层）**

  ⚠️ **这一步的护栏是 `tsc`，不是 vitest。**
  删掉 `origin` 之后，用户气泡**再也不可能**有「来源」了 ⇒ 最好的护栏是**类型**：
  传 `origin` 必须编译不过。

  在 `frontend/src/components/ai-workspace/useAgentStream.test.ts` 里加一个用例
  （沿用该文件已有的 `renderHook` + 注入 `subscribe`/`loadState` 的写法）：

  ```ts
  it('用户气泡不再有「来源」概念', async () => {
    const { captured, subscribe } = fakeSubscribe();
    const loadState = vi.fn(async () => ({ ...SNAPSHOT, messages: [] }));

    const { act, result } = await renderHook(() =>
      useAgentStream({
        conversationId: 'c1',
        subscribe,
        loadState,
      }),
    );

    await act(async () => {
      // @ts-expect-error 用户气泡不再有「来源」概念 ⇒ 不该再能传 origin
      result.current.appendUserMessage('你好', 'context');
    });

    // 消息照样上屏（只是没有来源标记了）
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0]).not.toHaveProperty('origin');
  });
  ```

  **为什么是 `@ts-expect-error` 而不是普通断言**：
  运行时断言「没有 origin」今天就成立（`appendUserMessage` 不传 origin 时本来就没有）⇒ 护不住任何东西。
  `@ts-expect-error` 才是真护栏 ——
  **今天 `origin` 参数还在 ⇒ 这行编译得过 ⇒ `@ts-expect-error` 报「未使用」⇒ `tsc` 失败（红）**；
  删掉 `origin` 参数后这行编译不过 ⇒ `@ts-expect-error` 被用上 ⇒ `tsc` 通过（绿）。

- [ ] **Step 2: 跑 `tsc`，确认它红**

  ```bash
  cd frontend
  npx tsc --noEmit
  ```

  预期：**失败**，报
  `error TS2578: Unused '@ts-expect-error' directive.`
  （已实测：今天的 `appendUserMessage` 确实还收 `origin` ⇒ 这条护栏确实是红的。）

  > 若这里**没有**报错，说明 `origin` 参数今天已经不存在了 ⇒ Task 3 已经完成，跳到 Step 4。

- [ ] **Step 3: 删掉 `origin` 字段与相关参数**

  `frontend/src/components/ai-workspace/useAgentStream.ts`：

  - `ChatMessage` 里删掉：

    ```ts
    /**
     * 这条消息的**来源**。
     * …
     */
    origin?: 'context';
    ```

  - `appendUserMessage` 的签名与实现：`appendUserMessage: (text: string) => void`，
    实现里去掉 `origin` 形参与 `...(origin === undefined ? {} : { origin })`。
  - `createUserMessage(text: string): ChatMessage`，去掉 `origin` 形参与那一行展开。
  - 保留 `snapshotToMessages` 等历史重建路径**不动** ⇒ 库里旧消息按普通用户气泡回来。

  `frontend/src/components/ai-workspace/MessageBubble.tsx`：

  - 删掉用户气泡里那一整块（`message.origin === 'context' ? ( … ) : null`）与其注释。
  - 若 `Tag` 变成没人用 ⇒ 从 `import { Alert, Avatar, Tag, theme } from 'antd';` 里删掉 `Tag`。

- [ ] **Step 4: 跑测试**

  ```bash
  cd frontend
  npx vitest run --config vitest.local.config.ts src/components/ai-workspace
  ```

  预期：全绿。

- [ ] **Step 5: 类型检查 + lint（含 `@ts-expect-error` 护栏转绿）**

  ```bash
  cd frontend
  npx tsc --noEmit
  npx biome lint
  ```

  预期：**都无输出**。
  （`tsc` 从 Step 2 的红转绿 ⇒ 护栏生效：现在真的传不了 `origin` 了。）

- [ ] **Step 6: 提交**

  ```bash
  cd /Users/ruanying/project/ai-admin-com
  git add frontend/src/components/ai-workspace/useAgentStream.ts \
          frontend/src/components/ai-workspace/useAgentStream.test.ts \
          frontend/src/components/ai-workspace/MessageBubble.tsx
  git commit -m "refactor(ai): 去掉用户气泡的「上下文」来源标记"
  ```

---

### Task 4: 收尾验收

**Files:** 无代码改动（只跑验证 + 记录）。

- [ ] **Step 1: 全量类型检查 + lint + 测试**

  ```bash
  cd frontend
  npx tsc --noEmit
  npx biome lint
  npx vitest run --config vitest.local.config.ts
  ```

  预期：全绿，一条失败都没有。

- [ ] **Step 2: 确认没有残留**

  ```bash
  cd /Users/ruanying/project/ai-admin-com
  grep -rn "requestInject\|injectRequest\|contextPromptText\|origin === 'context'" frontend/src --include=*.ts --include=*.tsx
  ```

  预期：**只剩** `frontend/src/components/ai-workspace/useWorkspace.test.ts` 里
  那个**故意保留**的 `injectRequest`（Task 1 的护栏）。
  其余任何命中都要处理掉。

- [ ] **Step 3: 手工验收（需要起服务）**

  ```bash
  # 终端 A：AI 服务
  cd /Users/ruanying/project/ai-admin-com
  npm run dev:ai          # → http://localhost:3100

  # 终端 B：前端
  cd /Users/ruanying/project/ai-admin-com
  npm run dev:frontend    # → http://localhost:8001
  ```

  在 `http://localhost:8001/pm/task` 点任意一行的「讨论」，逐条确认：

  1. 右侧 AI 面板展开，停在「对话」页签；
  2. 面板头部出现「正在讨论任务 #<id> <标题>」条；
  3. **聊天区没有任何新气泡**（今天会多出一条蓝色的「已切换到当前任务：…」）；
  4. 网络面板里**没有** `POST /ai-api/api/agent/<cid>/command` 请求；
  5. 自己打一句「这个任务做完了吗」⇒ 这条命令**带** `context`（看请求体里有 `context.task.id`），
     且智能体回答的是这条任务；
  6. 再点另一行的「讨论」⇒ 头部条换成新任务；再发一句 ⇒ 命令里的 `context` 跟着换了。

- [ ] **Step 4: 把验收结果写进提交**

  若 Step 3 全部符合预期，则无需额外提交（代码已在 Task 1–3 提交）。
  若发现不符合：修完再提交，提交信息写清修的是什么
  （例：`fix(ai): 点「讨论」后仍多发了一条命令`）。

---

## 已知取舍（实现时不要「顺手修」）

- 库里历史上那些「已切换到当前任务：…」的 USER 消息（改之前自动发的）现在会按**普通用户气泡**显示 ——
  这是**存量数据的自然结果**，不是 bug，不要去清洗数据。
- `frontend/src/components/pm/aiContext.ts` 里的 `contextSkillLabel` 本来就没人用，**本次不动**。
- 服务端 `backend/ai/` 一行都不动。它对上下文每条消息都带（`renderAiTaskContext`），
  所以「用户自己说的第一句话带上下文」这件事**本来就有**，不需要补。
