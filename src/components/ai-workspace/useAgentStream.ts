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
}

/** hook 的返回值。 */
export interface AgentStream {
  /** 气泡列表（用户与助手混在一起，按时间排）。 */
  messages: ChatMessage[];
  /** 本轮是否在进行中（`agent_settled` 结束它）。 */
  streaming: boolean;
  /** 事件流是不是连着的。 */
  connected: boolean;
  /** 追加一条用户气泡（发送时乐观上屏）。 */
  appendUserMessage: (text: string) => void;
  /** 用一份**已经拿到的**快照重建界面（刷新页面恢复历史）。 */
  restore: (snapshot: AiState, conversationId: string) => void;
  /** 用快照重建界面（断线重连后调用）。 */
  resync: () => Promise<void>;
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
}

/** 初始状态。 */
const EMPTY_STATE: StreamState = { messages: [], streaming: false };

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
      };
    }
    case 'text_delta':
      return withActiveMessage(state, (message) => ({
        ...message,
        text: message.text + event.delta,
      }));
    case 'message_end':
      return withActiveMessage(state, (message) => ({
        ...message,
        // 正文空着（重连丢了 delta）⇒ 用 message_end 的完整文本补上
        text: message.text || event.text || '',
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
      return { ...state, activeId: undefined, streaming: false };
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
    commands: [],
  }));
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
  // 乐观上屏、还没落库的用户消息（重连快照里没有它们时要留住）
  const pendingUserMessagesRef = useRef<string[]>([]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    subscribeRef.current = options.subscribe ?? defaultSubscribe;
    loadStateRef.current = options.loadState ?? getAiState;
  });

  /** 用一份快照重建界面。 */
  const applySnapshot = useCallback((snapshot: AiState, id: string): void => {
    const rebuilt = snapshotToMessages(snapshot);
    // 快照里还没有的本地用户消息要留住（服务端可能还没落库）
    const missing = pendingUserMessagesRef.current.filter(
      (text) =>
        !rebuilt.some(
          (message) => message.role === 'user' && message.text === text,
        ),
    );
    pendingUserMessagesRef.current = pendingUserMessagesRef.current.filter(
      (text) => !missing.includes(text),
    );
    setState({
      conversationId: id,
      messages: [...rebuilt, ...missing.map((text) => createUserMessage(text))],
      activeId: undefined,
      streaming: snapshot.isStreaming === true,
    });
  }, []);

  /** 用一份已经拿到的快照重建界面（刷新页面恢复历史）。 */
  const restore = useCallback(
    (snapshot: AiState, id: string): void => {
      applySnapshot(snapshot, id);
    },
    [applySnapshot],
  );

  /** 用快照重建界面。 */
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
        : { ...EMPTY_STATE, conversationId },
    );
    pendingUserMessagesRef.current = [];

    const cancel = subscribeRef.current(
      conversationId,
      (event) => {
        if (disposed) {
          return;
        }
        if (event.type === 'connected') {
          // 连上了（首次连接或断线重连）⇒ 用快照重建，不自己猜增量
          setConnected(true);
          void resync();
          return;
        }
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
    };
  }, [conversationId, resync]);

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

  return {
    messages: state.messages,
    streaming: state.streaming,
    connected,
    appendUserMessage,
    restore,
    resync,
  };
}
