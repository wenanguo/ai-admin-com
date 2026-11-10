/**
 * AI 对话的**流式状态机**：把 SSE 事件变成界面状态。
 *
 * ## 为什么是快照为真相
 *
 * SSE 是**增量**的：断线、刷新、晚连都会丢帧 ⇒ 界面不能靠事件自己拼历史。
 * 服务端的 `GET /api/agent/:cid/state` 会把已有消息全给回来 ⇒
 * **每次连上（首次连接或断线重连）都用它重建界面**（`connected` 事件触发）。
 *
 * ## 事件 → 界面的对应
 *
 * | 事件 | 界面 |
 * |---|---|
 * | `message_start` | 开一个新的助手气泡，本轮开始 |
 * | `text_delta` | 累积进当前气泡的正文 |
 * | `tool_call` | 追加一张命令卡片（执行中） |
 * | `tool_result` | 更新那张卡片（已执行 / 失败） |
 * | `message_end` | 收尾这一轮；带 `error` 时标出失败 |
 * | `agent_settled` | 本轮结束，输入解禁 |
 *
 * 前端**不做任何业务判定**（这条命令危不危险、能不能撤销）——
 * 那是命令层与服务端的事（`src/services/api/ai/types.ts` 的原话）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAiState } from '@/services/api/ai/client';
import { subscribeAiEvents } from '@/services/api/ai/sse';
import type { AiEvent, AiState } from '@/services/api/ai/types';

/** 命令卡片的状态：只有 tool_call（还没结果）/ 已执行 / 失败。 */
export type CommandStatus = 'running' | 'ok' | 'error';

/** 一张命令卡片（一次 `tool_call` 加上它的 `tool_result`）。 */
export interface ChatCommand {
  /** 卡片 id（同一轮内自增，用来把 `tool_result` 对回 `tool_call`）。 */
  id: string;
  /** 命令名（`tool_call` 的 toolName）。 */
  toolName: string;
  /** 状态。 */
  status: CommandStatus;
  /** 自然语言摘要（`tool_result.summary`，模型写的）。 */
  summary?: string;
}

/** 一个气泡。 */
export interface ChatMessage {
  /** 气泡 id。 */
  id: string;
  /** 角色。 */
  role: 'user' | 'assistant';
  /** 正文（`text_delta` 累积出来的 / 快照里的 content）。 */
  text: string;
  /**
   * 服务端在 `message_end` 里给的**完整正文**。
   *
   * ⚠️ 为什么单独存一份：`text_delta` 可能被服务端的帧缓冲淘汰
   *    （16MB 上限，见服务端 `src/agent/frame-buffer.ts`）
   *    ⇒ 累积出来的 `text` 可能是**残缺**的
   *    ⇒ 而落库的那一条（快照里的 content）用的是 `message_end` 的完整正文
   *    ⇒ 拿它对账才能认出「这是同一轮」。
   */
  serverText?: string;
  /** 这一轮里的命令卡片。 */
  commands: ChatCommand[];
  /** 这一轮失败的原因（`message_end.error`）—— 正常结束没有这个字段。 */
  error?: string;
}

/** 订阅事件流的形状（与 `subscribeAiEvents` 一致，测试注入假实现用）。 */
export type AiEventSubscriber = (
  conversationId: string,
  onEvent: (event: AiEvent) => void,
  onError?: (error: Error) => void,
) => () => void;

/** hook 的入参。 */
export interface UseAgentStreamOptions {
  /** 会话 id（为空时不订阅事件流）。 */
  conversationId?: string;
  /** 读会话快照（重连后用它重建界面）—— 缺省用 `getAiState`。 */
  loadState?: (conversationId: string) => Promise<AiState>;
  /** 订阅事件流 —— 缺省用 `subscribeAiEvents`。 */
  subscribe?: AiEventSubscriber;
  /**
   * 回放窗口的**最长时长**（毫秒）—— 缺省 {@link REPLAY_MAX_WINDOW_MS}。
   *
   * ⚠️ 这是**兜底**：快照请求卡住时（服务没起来、连接半开），
   *    窗口不能一直开着 —— 开着就会把实时帧一直攒着不上屏。
   */
  replayWindowMs?: number;
  /**
   * **写回成功**的回调（AI 真的改了某条任务时）。
   *
   * ⚠️ 这不是界面状态，是**副作用**（要让左边的列表/看板/甘特刷新+高亮）
   *    ⇒ 不能塞进 `StreamState` ⇒ 走回调。
   */
  onEntityUpdated?: (update: {
    entityType: 'task';
    entityId: number;
    fields: string[];
  }) => void;
}

/** hook 的返回值。 */
export interface AgentStream {
  /** 气泡列表（用户与助手混在一起，按时间排）。 */
  messages: ChatMessage[];
  /** 本轮是否在进行中（`agent_settled` 结束它）。 */
  streaming: boolean;
  /** 事件流是不是连着的。 */
  connected: boolean;
  /** 当前模型（快照里的 `model`；服务端**没有**模型列表端点 ⇒ 只有这一个）。 */
  model?: string;
  /**
   * 模型当前的「思考」内容（思考级别开了才有）。
   *
   * ⚠️ **不是对话内容** ⇒ 不进气泡，只在输入区上方显示「思考中…」。
   *    一旦有正文（`text_delta`）或本轮结束，就清掉。
   */
  thinking?: string;
  /**
   * 当前**挂起中**的修改（等用户点头）。
   *
   * ⚠️ 服务端在 `tool_call` hook 里同步挂起 ⇒ 那一轮在等 ⇒
   *    界面上要显示「等待你确认」（不然看起来像卡死）。
   */
  pendingItems: AiPendingItem[];
  /** 追加一条用户气泡（发送时乐观上屏）。 */
  appendUserMessage: (text: string) => void;
  /** 用一份**已经拿到的**快照重建界面（刷新页面恢复历史）。 */
  restore: (snapshot: AiState, conversationId: string) => void;
  /** 用快照重建界面（断线重连后调用）。 */
  resync: () => Promise<void>;
  /**
   * 强行结束本轮（用户点了「停止生成」）。
   *
   * ⚠️ **乐观解禁**：不等服务端的 `agent_settled` 帧，先把输入框放开。
   *    理由：万一服务端那一帧丢了（断线），界面就会永远停在「本轮进行中…」
   *    ⇒ 用户再也没有出路。真的 `agent_settled` 到了也是幂等的（再解一次）。
   */
  settle: () => void;
}

/** 一个挂起中的修改。 */
export interface AiPendingItem {
  /** 待确认行的 id（批准/拒绝时用它）。 */
  id: string;
  /** 命令（工具）名。 */
  command: string;
  /** 参数。 */
  args: Record<string, unknown>;
}

/** 内部状态。 */
interface StreamState {
  /** 这份状态属于哪个会话（换会话时要清空旧的）。 */
  conversationId?: string;
  /** 气泡列表。 */
  messages: ChatMessage[];
  /** 正在累积的那个助手气泡（下一段 delta 进它）。 */
  activeId?: string;
  /** 本轮是否在进行中。 */
  streaming: boolean;
  /** 当前模型（快照里的 `model`；快照没有就是 undefined）。 */
  model?: string;
  /** 当前的思考内容（不是对话内容）。 */
  thinking: string;
  /** 当前挂起中的修改（等用户点头）。 */
  pendingItems: AiPendingItem[];
}

/**
 * 一轮里的命令卡片（连同它属于哪一轮的话）。
 *
 * ⚠️ 快照里**没有**工具调用历史（服务端不持久化 `tool_call`/`tool_result`）
 * ⇒ 重建界面时只能靠本地已知的卡片补回去 ⇒ 需要记住「这些卡片属于哪一轮」。
 */
interface CommandSource {
  /** 这一轮助手说的话（用来跟快照里的消息对上）。 */
  text: string;
  /** 这一轮的命令卡片。 */
  commands: ChatCommand[];
}

/**
 * **回放窗口**的内部状态。
 *
 * ## 为什么有窗口，而不是「快照一落地就清标志」
 *
 * 服务端连上后**立刻**把整段历史（回放）写进同一个响应
 * （服务端 `src/app/api/agent/[conversationId]/events/route.ts`：
 * `write(connected)` → `for (const frame of snapshot) write(...)`），
 * 而客户端收到 `connected` 就去拉快照 ⇒ **两者赛跑**。
 *
 * ⚠️ 快照**可能落在回放的中间**（回放跨多个 chunk 时必然如此）
 *    ⇒ 「快照落地」不等于「回放结束」⇒ 回放的**尾巴**还会再来。
 *    尾巴直接上屏 ⇒ 历史被渲染两遍（而且是永久的）。
 *
 * ## 窗口什么时候关
 *
 * 「快照已落地」+「**回放收完**」（收完的轮数 ≥ 快照里的助手消息数）
 * ⇒ 整段回放都到了 ⇒ 关窗口。
 * 收不齐（服务端重启后内存里的帧缓冲空了、或者旧帧被淘汰了）
 * ⇒ 靠静默期 `REPLAY_SETTLE_MS` 兜底。
 * 快照**永远不回来**（请求卡住）⇒ 靠窗口上限 `REPLAY_MAX_WINDOW_MS` 兜底。
 *
 * ## 关窗口时那些帧怎么办
 *
 * - **快照里有**的那几轮 ⇒ 正文不上屏（快照才是真相），但**命令卡片**要合并回去
 *   （快照里没有工具调用历史）。
 * - **快照之后才发生的**那几轮（用户在重连后又发了一句话）⇒ **要上屏**
 *   （快照是连上那一刻拍的，里面没有它们 ⇒ 丢了就是「助手不回」）。
 * - **一个快照都没拿到** ⇒ 回放的积压就是历史 ⇒ 整个渲染出来
 *   （比空对话强得多）。
 */
interface ReplayWindow {
  /** 窗口开着吗（开着时进来的帧**不上屏**）。 */
  open: boolean;
  /** 快照到了吗（没到之前不能关窗口：关了就没有真相了）。 */
  snapshotReady: boolean;
  /** 窗口里攒下的帧（用来把命令卡片补回去）。 */
  buffer: StreamState;
  /** 回放里已经**收完**了几轮（`message_end` 的个数）。 */
  completedTurns: number;
  /**
   * 快照里有几条助手消息。
   *
   * ⇒ 回放收完的轮数够了，就说明**整段回放都到了** ⇒ 可以关窗口了。
   */
  expectedTurns?: number;
  /** 要用的快照。 */
  snapshot?: AiState;
  /** 静默计时器。 */
  timer?: ReturnType<typeof setTimeout>;
  /** 窗口上限计时器（硬兜底：快照卡住时到点就关）。 */
  maxTimer?: ReturnType<typeof setTimeout>;
  /**
   * 窗口是不是被「上限」关掉的。
   *
   * ⇒ 这种情况下**迟到的快照还要上屏**（否则历史就凭空少了）。
   */
  closedByTimeout: boolean;
}

/**
 * 回放窗口的静默期（**兜底**）：这么久没有新帧 ⇒ 强制关窗口。
 *
 * ⚠️ 正常情况下窗口靠「回放收完」（`completedTurns >= expectedTurns`）关
 *    ⇒ 回放与快照对得上时**不等**这个静默期。
 *    这个静默期只在**对不上**时兜底
 *    （服务端重启后内存里的帧缓冲空了、或者旧帧被淘汰了）。
 *
 * ⚠️ 为什么不能太短：回放是服务端**同步写完**的同一个响应，
 *    但**网络可以把它拆成几块**（代理缓冲、分块传输）
 *    ⇒ 静默期要盖得住「回放还在路上」的那段时间
 *    （e2e 的「快照落在回放中间」用例里，回放的尾巴隔了 600ms 才到）。
 *    ⚠️ 而且窗口开着的时候进来的帧**不上屏** ⇒ 静默期就是
 *    「用户刚发的话要等多久才看见」⇒ 但宁可晚一点，也不能把回放的尾巴
 *    漏到窗口外面（那会让历史被渲染两遍）。
 */
const REPLAY_SETTLE_MS = 1000;

/**
 * 回放窗口的**最长时长**（硬兜底）：这么久窗口还开着 ⇒ 强制关。
 *
 * ⚠️ 为什么必须有：快照请求可能**永远不回来**（服务卡住、连接半开）
 *    ⇒ 窗口一直开着 ⇒ 实时帧一直被攒着（用户看到的是「我发了话，助手不回」）。
 *    到点就关 ⇒ 攒下的东西渲染出来（宁可少一点历史，也不能吞掉实时帧）。
 *
 * ⚠️ 它要比「快照请求的超时」长一点（`client.ts` 里的 `SNAPSHOT_TIMEOUT_MS`）：
 *    让请求先失败 ⇒ 走「快照读不到」那条路 ⇒ 历史由回放的积压顶上。
 */
const REPLAY_MAX_WINDOW_MS = 4000;

/** 初始状态。 */
const EMPTY_STATE: StreamState = {
  messages: [],
  streaming: false,
  thinking: '',
  pendingItems: [],
};

/** 全局自增序号（气泡与卡片都用它做 id）。 */
let idSeed = 0;

/** 取一个新 id。 */
function nextId(prefix: string): string {
  idSeed += 1;
  return `${prefix}-${idSeed}`;
}

/** 造一个空白的助手气泡。 */
function createAssistantMessage(): ChatMessage {
  return { id: nextId('msg'), role: 'assistant', text: '', commands: [] };
}

/** 造一条用户气泡。 */
function createUserMessage(text: string): ChatMessage {
  return { id: nextId('msg'), role: 'user', text, commands: [] };
}

/** 找到最后一张还没出结果的同名命令卡片。 */
function findPendingCommandIndex(
  commands: ChatCommand[],
  toolName: string,
): number {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index];
    if (
      command &&
      command.toolName === toolName &&
      command.status === 'running'
    ) {
      return index;
    }
  }
  return -1;
}

/**
 * 把 `tool_result` 落到对应的卡片上。
 *
 * 找不到对应的 `tool_call`（重连丢了那一帧）⇒ 补一张已经完成的卡片，
 * 不能把结果弄丢 —— 结果比调用过程重要。
 */
function applyToolResult(
  commands: ChatCommand[],
  event: Extract<AiEvent, { type: 'tool_result' }>,
): ChatCommand[] {
  const index = findPendingCommandIndex(commands, event.toolName);
  if (index < 0) {
    return [
      ...commands,
      {
        id: nextId('cmd'),
        toolName: event.toolName,
        status: event.status,
        summary: event.summary,
      },
    ];
  }
  return commands.map((command, position) =>
    position === index
      ? {
          ...command,
          status: event.status,
          summary: event.summary ?? command.summary,
        }
      : command,
  );
}

/**
 * 改「当前那个助手气泡」。
 *
 * 找不到就**新建**一个 ——
 * 断线重连可能丢过 `message_start`，只剩 `text_delta` / `tool_call`。
 */
function withActiveMessage(
  state: StreamState,
  update: (message: ChatMessage) => ChatMessage,
): StreamState {
  const index = state.activeId
    ? state.messages.findIndex((message) => message.id === state.activeId)
    : -1;
  if (index < 0) {
    const message = update(createAssistantMessage());
    return {
      ...state,
      messages: [...state.messages, message],
      activeId: message.id,
    };
  }
  return {
    ...state,
    messages: state.messages.map((message, position) =>
      position === index ? update(message) : message,
    ),
  };
}

/** 把一个事件变成新的界面状态。 */
export function applyAiEvent(state: StreamState, event: AiEvent): StreamState {
  switch (event.type) {
    case 'message_start': {
      // 开一个新气泡（助手一轮可能有多条消息）
      const message = createAssistantMessage();
      return {
        ...state,
        messages: [...state.messages, message],
        activeId: message.id,
        streaming: true,
        // ⚠️ 开始说话了 ⇒ 思考阶段结束
        thinking: '',
      };
    }
    case 'text_delta':
      return withActiveMessage(state, (message) => ({
        ...message,
        text: message.text + event.delta,
      }));
    case 'thinking_delta':
      // ⚠️ 思考**不进气泡**（不是助手说的话）⇒ 只记在这儿，供界面显示「思考中…」
      return {
        ...state,
        thinking: state.thinking + event.delta,
      };
    case 'message_end':
      return withActiveMessage(state, (message) => ({
        ...message,
        // 正文空着（重连丢了 delta）⇒ 用 message_end 的完整文本补上
        text: message.text || event.text || '',
        // ⚠️ 服务端的**完整正文**单独记一份（对账用，见 ChatMessage.serverText）
        serverText: event.text || message.serverText,
        error: event.error ?? message.error,
      }));
    case 'tool_call':
      return withActiveMessage(state, (message) => ({
        ...message,
        commands: [
          ...message.commands,
          {
            id: nextId('cmd'),
            toolName: event.toolName,
            status: 'running',
          },
        ],
      }));
    case 'tool_result':
      return withActiveMessage(state, (message) => ({
        ...message,
        commands: applyToolResult(message.commands, event),
      }));
    case 'agent_settled':
      // 本轮结束：输入解禁，下一段 delta 另开一个气泡
      return { ...state, activeId: undefined, streaming: false, thinking: '' };
    case 'pending':
      // ⚠️ 挂起中：服务端在等用户点头 ⇒ 记下来（界面显示「等待你确认」）
      return {
        ...state,
        pendingItems: [
          ...state.pendingItems.filter((item) => item.id !== event.id),
          { id: event.id, command: event.command, args: event.args },
        ],
      };
    default:
      // 不认识的事件（服务端以后加的）⇒ 原样不动，不崩
      return state;
  }
}

/** 快照里的消息 → 气泡。 */
function snapshotToMessages(snapshot: AiState): ChatMessage[] {
  return (snapshot.messages ?? []).map((message) => ({
    id: message.id ?? nextId('msg'),
    // SYSTEM 消息在界面上也当助手的话（它是系统提示，不是用户说的）
    role: message.role === 'USER' ? 'user' : 'assistant',
    text: message.content,
    // 快照里的 content 就是服务端落库的完整正文
    serverText: message.content,
    commands: [],
  }));
}

/** 快照里的助手消息条数（回放收完的轮数够了 ⇒ 整段回放都到了）。 */
function countAssistantMessages(snapshot: AiState): number {
  return (snapshot.messages ?? []).filter(
    (message) => message.role === 'ASSISTANT',
  ).length;
}

/**
 * 把窗口里攒下的轮次分成「快照里已经有了的」与「快照之后才发生的」。
 *
 * ## 为什么不能一律丢掉
 *
 * 窗口开着的时候，用户可能又发了一句话 ⇒ 服务端回的新一轮**也**进了缓冲区。
 * 那一轮**不在**快照里（快照是连上那一刻拍的）⇒ 一律丢掉就把它吞了
 * （用户看到的是「我发了话，助手却不回」）。
 *
 * ## 怎么分
 *
 * - **按正文对**：快照里的助手消息正文 == 缓冲里那一轮的正文 ⇒ 同一轮（回放）。
 *   （服务端落库的就是助手那一轮的正文，见服务端 `src/agent/runtime.ts`
 *   的 `extractAssistantText` ⇒ 正文相同就一定是同一轮。）
 * - **按条数兜底**：缓冲里的轮数比快照里的助手消息还多 ⇒ 末尾多出来的那几条
 *   一定是新的（快照更早 ⇒ 多出来的只能是连上之后才发生的）。
 */
function partitionTurns(
  buffered: ChatMessage[],
  snapshot: AiState,
): { replayed: ChatMessage[]; fresh: ChatMessage[] } {
  const snapshotTexts = (snapshot.messages ?? [])
    .filter((message) => message.role === 'ASSISTANT')
    .map((message) => message.content);
  const turns = buffered.filter((message) => message.role === 'assistant');
  // 末尾多出来的那几条一定是新的
  const tailStart = Math.min(turns.length, snapshotTexts.length);
  const used = new Set<number>();
  const replayed: ChatMessage[] = [];
  const fresh: ChatMessage[] = [];
  turns.forEach((turn, position) => {
    if (position >= tailStart) {
      fresh.push(turn);
      return;
    }
    const matched = snapshotTexts.findIndex(
      (text, index) =>
        !used.has(index) && text === (turn.serverText ?? turn.text),
    );
    if (matched < 0) {
      fresh.push(turn);
      return;
    }
    used.add(matched);
    replayed.push(turn);
  });
  return { replayed, fresh };
}

/** 从消息列表里挑出「带命令卡片」的那些轮次。 */
function collectCommandSources(messages: ChatMessage[]): CommandSource[] {
  return messages
    .filter((message) => message.commands.length > 0)
    .map((message) => ({
      // ⚠️ 对账用服务端的**完整正文**（累积出来的正文可能是残缺的）
      text: message.serverText ?? message.text,
      commands: message.commands,
    }));
}

/** 两个气泡是不是同一轮（比服务端的完整正文，没有就比正文）。 */
function isSameTurn(left: ChatMessage, right: ChatMessage): boolean {
  return (
    left.role === right.role &&
    (left.serverText ?? left.text) === (right.serverText ?? right.text)
  );
}

/** 两张卡片是不是同一张（合并时避免重复）。 */
function isSameCommand(left: ChatCommand, right: ChatCommand): boolean {
  return (
    left.toolName === right.toolName &&
    left.status === right.status &&
    left.summary === right.summary
  );
}

/**
 * 给一轮命令卡片找能挂的位置。
 *
 * - 正文**完全一样**的那条（最常见：本地那一轮 = 快照里那一轮）；
 * - 「一边是另一边的前缀」的那条（本地那一轮只收到了一半）；
 * - 都不行 ⇒ 挂到最后一条助手消息上。
 *
 * ⚠️ 宁可挂错位置也不要丢卡片：卡片丢了，用户会以为命令根本没执行。
 */
function findCommandTarget(
  messages: ChatMessage[],
  text: string,
): ChatMessage | undefined {
  const assistants = messages.filter((message) => message.role === 'assistant');
  if (assistants.length === 0) {
    return undefined;
  }
  if (text) {
    const exact = assistants.find((message) => message.text === text);
    if (exact) {
      return exact;
    }
    const partial = assistants.find(
      (message) =>
        message.text.length > 0 &&
        text.length > 0 &&
        (message.text.startsWith(text) || text.startsWith(message.text)),
    );
    if (partial) {
      return partial;
    }
  }
  return assistants[assistants.length - 1];
}

/**
 * 把命令卡片合并回重建后的消息列表。
 *
 * ⚠️ **快照里没有工具调用历史**（服务端不持久化 `tool_call`/`tool_result`）
 * ⇒ 重建时必须把本地已知的卡片补回去，否则用户会以为命令没执行
 * （规格 §3.4 的命令卡片是「命令层受控写入」的可见证据）。
 */
function mergeCommandSources(
  rebuilt: ChatMessage[],
  sources: CommandSource[],
): ChatMessage[] {
  if (sources.length === 0) {
    return rebuilt;
  }
  const messages = rebuilt.map((message) => ({
    ...message,
    commands: [...message.commands],
  }));
  for (const source of sources) {
    const target = findCommandTarget(messages, source.text);
    if (!target) {
      continue;
    }
    for (const command of source.commands) {
      const duplicated = target.commands.some((existing) =>
        isSameCommand(existing, command),
      );
      if (!duplicated) {
        target.commands.push(command);
      }
    }
  }
  return messages;
}

/** 缺省的订阅实现。 */
const defaultSubscribe: AiEventSubscriber = (
  conversationId,
  onEvent,
  onError,
) => subscribeAiEvents(conversationId, onEvent, onError);

/**
 * AI 对话的流式状态机。
 *
 * @param options 会话 id 与两个可注入的外部依赖。
 */
export function useAgentStream(options: UseAgentStreamOptions): AgentStream {
  const { conversationId } = options;
  const [state, setState] = useState<StreamState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);

  // 会话 id 放进 ref：回调里要用最新的值，又不能让订阅随它重建
  const conversationIdRef = useRef(conversationId);
  // 订阅与快照读取也放进 ref —— 换引用不该让事件流断开重连
  const subscribeRef = useRef<AiEventSubscriber>(defaultSubscribe);
  const loadStateRef = useRef<(id: string) => Promise<AiState>>(getAiState);
  // 写回成功的回调（换引用不该让事件流断开重连 ⇒ 放 ref）
  const onEntityUpdatedRef = useRef(options.onEntityUpdated);
  useEffect(() => {
    onEntityUpdatedRef.current = options.onEntityUpdated;
  }, [options.onEntityUpdated]);
  // 乐观上屏、还没落库的用户消息（重连快照里没有它们时要留住）
  const pendingUserMessagesRef = useRef<string[]>([]);
  // 回放窗口（服务端连上后会**立刻**回放整段历史 ⇒ 它与快照赛跑）
  const replayRef = useRef<ReplayWindow>({
    open: false,
    snapshotReady: false,
    completedTurns: 0,
    buffer: EMPTY_STATE,
    closedByTimeout: false,
  });
  // 窗口上限（毫秒）也放进 ref：它变了不该让事件流断开重连
  const replayWindowMsRef = useRef(
    options.replayWindowMs ?? REPLAY_MAX_WINDOW_MS,
  );

  useEffect(() => {
    conversationIdRef.current = conversationId;
    subscribeRef.current = options.subscribe ?? defaultSubscribe;
    loadStateRef.current = options.loadState ?? getAiState;
    replayWindowMsRef.current = options.replayWindowMs ?? REPLAY_MAX_WINDOW_MS;
  });

  /**
   * 用一份快照重建界面。
   *
   * @param snapshot 服务端快照。
   * @param id 会话 id。
   * @param buffered 窗口里攒下的东西（回放的积压）：
   *   - 里面**快照已经有的**轮次 ⇒ 正文不上屏（快照里有），命令卡片合并回去；
   *   - 里面**快照之后才发生的**轮次 ⇒ 要上屏（不能吞）。
   * @param keepLocal 用**当前界面**当积压（迟到的快照：别把已经渲染出来的
   *   实时帧弄丢）。
   */
  const applySnapshot = useCallback(
    (
      snapshot: AiState,
      id: string,
      buffered?: StreamState,
      keepLocal = false,
    ): void => {
      setState((previous) => {
        // 积压：回放窗口里攒的那些（或者迟到的快照 ⇒ 当前界面）
        const source = keepLocal ? previous : buffered;
        const partition = source
          ? partitionTurns(source.messages, snapshot)
          : { replayed: [], fresh: [] };
        const rebuilt = snapshotToMessages(snapshot);
        // ⚠️ 快照里**没有工具调用历史** ⇒ 把本地已知的命令卡片合并回去
        //（否则每次重建后「已执行」的卡片就消失了，用户会以为命令没跑）。
        const messages = mergeCommandSources(rebuilt, [
          ...collectCommandSources(previous.messages),
          ...collectCommandSources(partition.replayed),
        ]);
        // 快照里还没有的本地用户消息要留住（服务端可能还没落库）
        const missing = pendingUserMessagesRef.current.filter(
          (text) =>
            !messages.some(
              (message) => message.role === 'user' && message.text === text,
            ),
        );
        pendingUserMessagesRef.current = pendingUserMessagesRef.current.filter(
          (text) => !missing.includes(text),
        );
        // 快照之后才发生的轮次 ⇒ 补在历史后面（**不能吞**）
        const lastFresh = partition.fresh[partition.fresh.length - 1];
        const activeId =
          source?.activeId !== undefined && lastFresh?.id === source.activeId
            ? lastFresh.id
            : undefined;
        let streaming = snapshot.isStreaming === true;
        if (partition.fresh.length > 0) {
          streaming = source?.streaming === true;
        }
        if (activeId !== undefined) {
          streaming = true;
        }
        return {
          conversationId: id,
          messages: [
            ...messages,
            // 还没落库的用户消息（乐观上屏的）在前
            ...missing.map((text) => createUserMessage(text)),
            // 快照之后才发生的轮次（是那些消息的回复）在后
            ...partition.fresh,
          ],
          activeId,
          streaming,
          // 当前模型：服务端只有这一个（没有模型列表端点）
          model: snapshot.model,
          // 重建界面 ⇒ 思考阶段已经过去了
          thinking: '',
          // 重建界面 ⇒ 挂起中的修改也会重新收到 pending 事件（不保留旧的）
          pendingItems: [],
        };
      });
    },
    [],
  );

  /**
   * **没有快照**时：回放的积压就是历史。
   *
   * ⚠️ 早先的实现只把命令卡片合并回去 ⇒ 整段回放被丢弃
   *    （用户看到的历史凭空少了一截，直到下一次重连或刷新才回来）。
   *    ⇒ 这里把积压**整个渲染出来**（比空对话强得多）。
   */
  const applyBufferedBacklog = useCallback(
    (buffered: StreamState, id: string): void => {
      setState((previous) => {
        const backlog = buffered.messages;
        // 回放里本地没有的那些轮次 ⇒ 补在后面
        const extra = backlog.filter(
          (message) =>
            !previous.messages.some((item) => isSameTurn(item, message)),
        );
        // 命令卡片：本地已知的 + 回放里的，都要留下
        const messages = mergeCommandSources(
          [...previous.messages, ...extra],
          [
            ...collectCommandSources(previous.messages),
            ...collectCommandSources(backlog),
          ],
        );
        return {
          ...previous,
          conversationId: id,
          messages,
          activeId: buffered.activeId,
          streaming: buffered.streaming,
        };
      });
    },
    [],
  );

  /** 用一份已经拿到的快照重建界面（刷新页面恢复历史）。 */
  const restore = useCallback(
    (snapshot: AiState, id: string): void => {
      applySnapshot(snapshot, id);
    },
    [applySnapshot],
  );

  /** 用快照重建界面（断线重连后调用）。 */
  const resync = useCallback(async (): Promise<void> => {
    const id = conversationIdRef.current;
    if (!id) {
      return;
    }
    try {
      const snapshot = await loadStateRef.current(id);
      applySnapshot(snapshot, id);
    } catch {
      // 快照读不到（会话没了 / 网络断了）⇒ 保留本地界面，等下一次重连
    }
  }, [applySnapshot]);

  /**
   * 关掉回放窗口：把快照（连同窗口里攒下的命令卡片）一起上屏。
   *
   * 窗口里的那些**文本帧不上屏** —— 快照才是真相，回放会被它覆盖；
   * 但帧里的**命令卡片要留下**（快照里没有工具调用历史）。
   */
  const closeReplayWindow = useCallback((): void => {
    const window = replayRef.current;
    if (!window.open) {
      return;
    }
    window.open = false;
    if (window.timer !== undefined) {
      clearTimeout(window.timer);
      window.timer = undefined;
    }
    if (window.maxTimer !== undefined) {
      clearTimeout(window.maxTimer);
      window.maxTimer = undefined;
    }
    const snapshot = window.snapshot;
    const buffered = window.buffer;
    window.buffer = EMPTY_STATE;
    window.snapshot = undefined;
    window.snapshotReady = false;
    window.expectedTurns = undefined;

    const id = conversationIdRef.current;
    if (!id) {
      return;
    }
    if (snapshot) {
      // 快照是真相 ⇒ 用它重建；
      // 窗口里**快照之后才发生的**那几轮 ⇒ 一并上屏（不能吞）。
      applySnapshot(snapshot, id, buffered);
      return;
    }
    // 快照没拿到（读不到 / 超时）⇒ 回放的积压就是历史 ⇒ 整个渲染出来。
    applyBufferedBacklog(buffered, id);
  }, [applyBufferedBacklog, applySnapshot]);

  /**
   * 回放**收完**了就把窗口关上（不等静默期）。
   *
   * ## 为什么能这样判
   *
   * 服务端是 `write(connected)` → `for (const frame of snapshot) write(...)`
   * ⇒ **整段回放在服务端是同步写完的**，而客户端是在收到 `connected` 之后
   * 才去拉快照 ⇒ **快照一定包含整段回放**。
   *
   * ⇒ 回放里收完的轮数（`message_end` 的个数）够了 ⇒ 整段回放都到了
   *    ⇒ 再来的帧就是**新的**（不是回放的尾巴）⇒ 可以关窗口了。
   */
  const tryCloseReplayWindow = useCallback((): void => {
    const window = replayRef.current;
    if (!window.open || !window.snapshotReady) {
      return;
    }
    if (window.expectedTurns === undefined) {
      return;
    }
    if (window.completedTurns < window.expectedTurns) {
      return;
    }
    closeReplayWindow();
  }, [closeReplayWindow]);

  /**
   * 重新开始静默计时：又来新帧 ⇒ 回放还没完 ⇒ 窗口继续开着。
   */
  const scheduleSettle = useCallback((): void => {
    const window = replayRef.current;
    if (window.timer !== undefined) {
      clearTimeout(window.timer);
    }
    const arm = (): void => {
      window.timer = setTimeout(() => {
        window.timer = undefined;
        // 快照还没到 ⇒ 不能关（关了就没有真相了）⇒ 等它
        if (!window.snapshotReady) {
          return;
        }
        // ⚠️ 回放**正说到一半**（这一轮还没收完）⇒ 再等一轮静默。
        //    关了的话，回放的尾巴随后会直接上屏 ⇒ 历史被渲染**两遍**。
        if (window.buffer.activeId !== undefined) {
          arm();
          return;
        }
        closeReplayWindow();
      }, REPLAY_SETTLE_MS);
    };
    arm();
  }, [closeReplayWindow]);

  /**
   * 连上之后：打开回放窗口，拉快照，等回放静默了再一起上屏。
   */
  const startResync = useCallback((): void => {
    const window = replayRef.current;
    window.open = true;
    window.snapshotReady = false;
    window.snapshot = undefined;
    window.completedTurns = 0;
    window.expectedTurns = undefined;
    window.buffer = EMPTY_STATE;
    window.closedByTimeout = false;

    const id = conversationIdRef.current;
    if (!id) {
      closeReplayWindow();
      return;
    }

    // 窗口上限（硬兜底）：快照请求卡住 ⇒ 到点就关窗口，把攒下的渲染出来。
    //
    // ⚠️ 没有它的话，一个卡住的 `GET /state` 会让窗口一直开着
    //    ⇒ 实时帧全被攒着不上屏（用户看到的是「我发了话，助手不回」）。
    window.maxTimer = setTimeout(() => {
      const current = replayRef.current;
      if (!current.open) {
        return;
      }
      current.maxTimer = undefined;
      current.closedByTimeout = true;
      closeReplayWindow();
    }, replayWindowMsRef.current);

    void (async () => {
      let snapshot: AiState | undefined;
      try {
        snapshot = await loadStateRef.current(id);
      } catch {
        // 快照读不到（会话没了 / 网络断了 / 超时）⇒ 用回放的积压顶上
        snapshot = undefined;
      }
      const current = replayRef.current;
      if (!current.open) {
        // 窗口已经关了（换会话 / 组件卸载 / 到了上限）
        //
        // ⚠️ 被「上限」关的 ⇒ **迟到的快照还要上屏**
        //    （否则历史就凭空少了一截）。
        //    用「当前界面当积压」⇒ 已经渲染出来的实时帧不会被弄丢。
        if (
          current.closedByTimeout &&
          snapshot &&
          conversationIdRef.current === id
        ) {
          applySnapshot(snapshot, id, undefined, true);
        }
        return;
      }
      current.snapshot = snapshot;
      current.snapshotReady = true;
      if (snapshot) {
        current.expectedTurns = countAssistantMessages(snapshot);
      }
      scheduleSettle();
      // 回放已经收完 ⇒ 不用等静默期
      tryCloseReplayWindow();
    })();
  }, [applySnapshot, closeReplayWindow, scheduleSettle, tryCloseReplayWindow]);

  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }
    let disposed = false;
    // 换会话 ⇒ 旧界面清空（新会话的历史由快照带回来）。
    //
    // ⚠️ 用**函数式**更新：清空与重建快照可能撞车
    // （快照先落地、清空后落地 ⇒ 刚拉回来的历史又被抹掉）。
    // 状态里记着它属于哪个会话 ⇒ 已经重建过的就不动它。
    setState((previous) =>
      previous.conversationId === conversationId
        ? previous
        : // ⚠️ `model` 留着：它是**服务级**的配置（不是某个会话的属性），
          // 换会话时它不该闪一下「未知」。
          { ...EMPTY_STATE, conversationId, model: previous.model },
    );
    pendingUserMessagesRef.current = [];

    const cancel = subscribeRef.current(
      conversationId,
      (event) => {
        if (disposed) {
          return;
        }
        if (event.type === 'connected') {
          // 连上了（首次连接或断线重连）⇒ 打开回放窗口：
          // 历史以**快照**为准，回放的帧不直接上屏（否则会渲染两遍）。
          setConnected(true);
          startResync();
          return;
        }
        const window = replayRef.current;
        // ⚠️ **写回成功** ⇒ 这是**副作用**（左边要刷新+高亮），不是界面状态
        //    ⇒ **不能被回放窗口吞掉**：窗口开着的时候（刚连上 / 断线重连），
        //    写回事件会落到窗口里只做缓冲 ⇒ 表现为“写回了但列表不刷新”。
        //    ⇒ 副作用一律先发，再谈上屏。
        if (event.type === 'entity_updated') {
          onEntityUpdatedRef.current?.({
            entityType: event.entityType,
            entityId: event.entityId,
            fields: event.fields,
          });
        }
        if (window.open) {
          // 回放中的帧：**不上屏**（快照会覆盖它），
          // 但要攒着 —— 里面的**命令卡片**快照里没有。
          window.buffer = applyAiEvent(window.buffer, event);
          if (event.type === 'message_end') {
            window.completedTurns += 1;
          }
          scheduleSettle();
          // 回放收完了 ⇒ 不用再等静默期
          tryCloseReplayWindow();
          return;
        }
        // ⚠️ **写回成功** ⇒ 这是**副作用**（左边要刷新+高亮），不是界面状态
        //    （上面已经发过副作用了 ⇒ 这里只管界面状态）
        setState((previous) => applyAiEvent(previous, event));
      },
      () => {
        if (!disposed) {
          setConnected(false);
        }
      },
    );

    return () => {
      disposed = true;
      cancel();
      // 回放窗口关掉（定时器也清掉）——
      // 不留一个会在组件卸载后再 setState 的定时器。
      const window = replayRef.current;
      window.open = false;
      if (window.timer !== undefined) {
        clearTimeout(window.timer);
        window.timer = undefined;
      }
      if (window.maxTimer !== undefined) {
        clearTimeout(window.maxTimer);
        window.maxTimer = undefined;
      }
    };
  }, [conversationId, resync, scheduleSettle, startResync]);

  /** 追加一条用户气泡（发送时乐观上屏）。 */
  const appendUserMessage = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    pendingUserMessagesRef.current = [
      ...pendingUserMessagesRef.current,
      trimmed,
    ];
    setState((previous) => ({
      ...previous,
      messages: [...previous.messages, createUserMessage(trimmed)],
    }));
  }, []);

  /** 强行结束本轮（用户点了「停止生成」）。 */
  const settle = useCallback((): void => {
    setState((previous) =>
      previous.streaming
        ? { ...previous, activeId: undefined, streaming: false }
        : previous,
    );
  }, []);

  return {
    messages: state.messages,
    streaming: state.streaming,
    connected,
    model: state.model,
    thinking: state.thinking,
    pendingItems: state.pendingItems,
    appendUserMessage,
    restore,
    resync,
    settle,
  };
}
