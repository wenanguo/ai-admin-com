/**
 * AI 工作台的**会话**：会话 id 的生命周期 + 发送命令。
 *
 * ## 会话 id 从哪来
 *
 * 1. 第一次打开 ⇒ 没有存过的会话 ⇒ `createAiConversation()` 新建一个；
 * 2. 刷新页面 ⇒ `localStorage` 里存着 ⇒ 直接复用；
 * 3. 存着的那个服务端已经没有了（服务重启、数据清空）⇒ 换一个。
 *
 * ## 命令 id 谁来生成
 *
 * **组件自己生成**（`createAiCommandId()`），并通过 `options.id` 传给客户端。
 * ⚠️ 服务端按命令 id 去重 ⇒ **重试必须复用同一个 id**，
 * 换一个新 id 会让同一条命令真的再执行一遍（见 `retry`）。
 */

import { useModel } from '@umijs/max';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  abortAiConversation,
  approveAiPending,
  createAiCommandId,
  createAiConversation,
  getAiState,
  rejectAiPending,
  sendAiCommand,
} from '@/services/api/ai/client';
import { readWorkspaceStorage, writeWorkspaceStorage } from './storage';
import type { AiPendingItem, ChatMessage } from './useAgentStream';
import { useAgentStream } from './useAgentStream';

/** hook 的入参。 */
export interface UseWorkspaceOptions {
  /** 存会话 id 的 localStorage 键（缺省用默认的那个）。 */
  storageKey?: string;
}

/** hook 的返回值。 */
export interface Workspace {
  /** 当前会话 id（还没有时是 undefined）。 */
  conversationId?: string;
  /**
   * 当前模型（会话快照里的 `model`）。
   *
   * ⚠️ 服务端**没有**模型列表端点，也没有配额端点 ⇒ 页面只能显示这一个，
   * 更不能画一条没有数据源的配额进度条。
   */
  model?: string;
  /** 气泡列表。 */
  messages: ChatMessage[];
  /**
   * 模型当前的思考内容（思考级别开了才有）。
   *
   * ⚠️ **不是对话内容** ⇒ 只在输入区上方显示「思考中…」。
   */
  thinking?: string;
  /**
   * 当前**挂起中**的修改（等用户点头）。
   *
   * ⚠️ 服务端在 `tool_call` hook 里同步挂起 ⇒ 那一轮在等 ⇒
   *    界面上要显示「等待你确认」（不然看起来像卡死）。
   */
  pendingItems: AiPendingItem[];
  /** 本轮是否在进行中。 */
  streaming: boolean;
  /** 事件流是不是连着的。 */
  connected: boolean;
  /**
   * AI 服务是不是**不可用**（面板头部要挂一个「AI 服务不可用」的标签）。
   *
   * ⚠️ 不能直接用 `!connected`：首次连接**还没连上**的那一瞬间也是 false
   * ⇒ 每个页面刚打开都会闪一下「不可用」（服务其实是好的）。
   * ⇒ 只在「**曾经连上过、现在断了**」或「会话都建不起来」时才算不可用。
   */
  aiUnavailable: boolean;
  /** 命令还在发出去（还没被受理）。 */
  sending: boolean;
  /** 上一条命令发送失败的原因。 */
  sendError?: string;
  /**
   * 会话建不起来的原因（AI 服务不可达之类）。
   *
   * ⚠️ 面板是**浮层**（用户主动点开的）⇒ AI 服务不可达是**全局**状态，
   * 显示在面板里，而不是弹一次全局提示（那个会在每个页面上重复出现）。
   */
  connectionError?: string;
  /** 发送一句话。 */
  send: (text: string) => Promise<void>;
  /** 重试上一条失败的消息（**复用同一个命令 id**）。 */
  retry: () => Promise<void>;
  /**
   * 重连（会话建不起来时的重试入口）。
   *
   * 只提示不给出路是不行的 —— 用户没法自己恢复。
   * 重连 = 重跑一遍「建会话」的流程；会话 id 一旦建出来，
   * 事件流（`useAgentStream`）会跟着重新订阅。
   */
  reconnect: () => void;
  /**
   * 新建一个会话并切过去（「新对话」）。
   *
   * ⚠️ 新的会话 id 会写进 `localStorage` ⇒ 面板下次挂载时用的也是它，
   * 两边不会各说各话。
   */
  newConversation: () => Promise<void>;
  /**
   * 切到另一个已有的会话（「历史对话」）。
   *
   * 先读一次快照 —— 服务端不认这个会话时（被清掉了）就别切，
   * 否则界面会挂在一个死会话上。
   */
  switchConversation: (conversationId: string) => Promise<void>;
  /**
   * **中止**当前正在跑的那一轮（用户点「停止生成」）。
   *
   * ⚠️ 中止**不是回滚**：已经落库的消息与已经建出来的任务都还在。
   * ⚠️ 中止后**乐观地**解禁输入框（不等服务端的 `agent_settled` 帧）——
   *    万一那一帧丢了，界面就会永远停在「本轮进行中…」，用户再没有出路。
   */
  abort: () => Promise<void>;
  /** 正在中止（按钮转圈）。 */
  aborting: boolean;
  /** 中止失败的原因。 */
  abortError?: string;
  /**
   * **批准**一条挂起的修改（服务端会放行原工具调用 ⇒ 模型接着说）。
   *
   * @param id 待确认行的 id。
   */
  approvePending: (id: string) => Promise<void>;
  /**
   * **拒绝**一条挂起的修改（服务端会 block 掉 ⇒ 模型告诉用户这次没做成）。
   *
   * @param id 待确认行的 id。
   */
  rejectPending: (id: string) => Promise<void>;
}

/** 未知错误转成一句话。 */
function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '发送失败';
}

/**
 * AI 工作台的会话。
 *
 * @param options 存储键。
 */
export function useWorkspace(options: UseWorkspaceOptions = {}): Workspace {
  const storageKey = options.storageKey;
  // ⚠️ **当前讨论的上下文**是全局的（任务页点「与 AI 讨论」时设的）
  //    ⇒ 发消息时带上它，服务端才知道 AI 在聊哪条任务。
  //    （桥上那个「请求替用户发一句」的信号**故意不监听**：
  //      用户点「讨论」只该切上下文，不该替他说任何话 ⇒ 真发命令 = 真烧 token。）
  const aiContext = useModel('ai-bridge');
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined,
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  /** 会话建不起来的原因（AI 服务不可达之类）。 */
  const [connectionError, setConnectionError] = useState<string | undefined>(
    undefined,
  );
  /** 中止失败的原因。 */
  const [abortError, setAbortError] = useState<string | undefined>(undefined);
  /** 正在中止。 */
  const [aborting, setAborting] = useState(false);
  /** 上一条命令（重试时要复用它的 id）。 */
  const lastCommandRef = useRef<{ id: string; text: string } | undefined>(
    undefined,
  );
  /**
   * 建会话的**尝试次数**（重连时 +1 ⇒ effect 重跑一遍）。
   *
   * ⚠️ 不能简单地「再调一次 createAiConversation」——
   *    整段流程（读快照、复用会话 id、新建会话）都在 effect 里，
   *    重跑 effect 才是真正的「再来一次」。
   */
  const [attempt, setAttempt] = useState(0);
  /** 当前会话 id 的副本：发送是异步的，要读**最新**的值。 */
  const conversationIdRef = useRef<string | undefined>(undefined);
  /** 会话就绪的信号：会话建好（或建不出来）之后 resolve。 */
  const readyRef = useRef<Promise<void> | undefined>(undefined);

  const {
    messages,
    streaming,
    connected,
    model,
    thinking,
    pendingItems,
    appendUserMessage,
    restore,
    settle,
  } = useAgentStream({
    conversationId,
    // 写回成功 ⇒ 广播（任务页据此刷新 + 高亮那一行）
    onEntityUpdated: aiContext.notifyUpdate,
  });

  /**
   * 事件流**曾经**连上过吗。
   *
   * ⚠️ 用它区分「还没连上」与「连上又断了」——
   * 前者是正常状态（不能报「不可用」），后者才是真的不可用。
   */
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (connected) {
      setEverConnected(true);
    }
  }, [connected]);
  /** AI 服务不可用（面板头部据此挂「AI 服务不可用」的标签，规格 §3.10）。 */
  const aiUnavailable =
    connectionError !== undefined || (everConnected && !connected);

  // 会话的生命周期：复用 / 新建 / 换一个
  useEffect(() => {
    let disposed = false;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    readyRef.current = ready;

    const bootstrap = async (): Promise<void> => {
      const stored = readWorkspaceStorage(storageKey).conversationId;
      if (stored) {
        try {
          // 确认服务端还认这个会话（顺便把历史拿回来）
          const snapshot = await getAiState(stored);
          if (!disposed) {
            conversationIdRef.current = stored;
            setConversationId(stored);
            // 刷新页面后把历史拉回来（不依赖事件流连上）
            restore(snapshot, stored);
          }
          return;
        } catch {
          // 服务端已经没这个会话了 ⇒ 往下走新建
        }
      }
      try {
        const created = await createAiConversation();
        if (disposed) {
          return;
        }
        conversationIdRef.current = created.conversationId;
        setConversationId(created.conversationId);
        writeWorkspaceStorage(
          { conversationId: created.conversationId },
          storageKey,
        );
      } catch (error) {
        // 建不出来就留在「还没有会话」的状态：界面提示用户，不崩
        //
        // ⚠️ 这里**不弹全局提示**（AI 服务的请求已设 skipErrorHandler）——
        // 面板是**浮层**（用户主动点开的），服务没起来时不该在每个页面上都弹一次。
        // 失败的原因显示在面板里（`connectionError`）。
        if (!disposed) {
          setConnectionError(toMessage(error));
        }
      }
    };

    void bootstrap().finally(() => {
      resolveReady();
    });

    return () => {
      disposed = true;
      resolveReady();
    };
  }, [restore, storageKey, attempt]);

  /** 把一条命令发出去（id 由这里生成）。 */
  const submit = useCallback(
    async (id: string, text: string): Promise<void> => {
      const conversation = conversationIdRef.current;
      if (!conversation) {
        return;
      }
      setSendError(undefined);
      setSending(true);
      try {
        // ⚠️ **每条消息都带上下文**（不是只在会话创建时带）：
        //    上下文是「此刻在聊哪条任务」⇒ 用户换了任务，下一句就换。
        await sendAiCommand(conversation, text, {
          id,
          ...(aiContext.context ? { context: aiContext.context } : {}),
        });
      } catch (error) {
        setSendError(toMessage(error));
      } finally {
        setSending(false);
      }
    },
    [aiContext.context],
  );

  /** 发送一句话（用户说的立刻上屏，服务端受理之后再走事件流）。 */
  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      // 会话还没建好 ⇒ 等它（用户不用知道中间这几十毫秒）
      if (!conversationIdRef.current) {
        await readyRef.current;
      }
      if (!conversationIdRef.current) {
        setSendError('会话还没准备好，请稍后重试');
        return;
      }
      // ⚠️ id 在这里生成并留着 —— 重试要原样用回它
      const id = createAiCommandId();
      lastCommandRef.current = { id, text: trimmed };
      appendUserMessage(trimmed);
      await submit(id, trimmed);
    },
    [appendUserMessage, submit],
  );

  /** 重试上一条失败的消息：同一个 id，服务端不会真的再执行一遍。 */
  const retry = useCallback(async (): Promise<void> => {
    const last = lastCommandRef.current;
    if (!last) {
      return;
    }
    await submit(last.id, last.text);
  }, [submit]);

  /** 重连：重跑一遍「建会话」的流程。 */
  const reconnect = useCallback((): void => {
    setConnectionError(undefined);
    setAttempt((previous) => previous + 1);
  }, []);

  /** 新建一个会话并切过去。 */
  const newConversation = useCallback(async (): Promise<void> => {
    setSendError(undefined);
    try {
      const created = await createAiConversation();
      conversationIdRef.current = created.conversationId;
      setConversationId(created.conversationId);
      writeWorkspaceStorage(
        { conversationId: created.conversationId },
        storageKey,
      );
      // 上一条命令的重试 id 对新会话没有意义了
      lastCommandRef.current = undefined;
    } catch (error) {
      setSendError(toMessage(error));
    }
  }, [storageKey]);

  /** 切到另一个已有的会话。 */
  const switchConversation = useCallback(
    async (id: string): Promise<void> => {
      setSendError(undefined);
      try {
        // 先读快照：服务端不认这个会话时就别切
        const snapshot = await getAiState(id);
        conversationIdRef.current = id;
        setConversationId(id);
        writeWorkspaceStorage({ conversationId: id }, storageKey);
        lastCommandRef.current = undefined;
        restore(snapshot, id);
      } catch (error) {
        setSendError(toMessage(error));
      }
    },
    [restore, storageKey],
  );

  /** 中止当前这一轮。 */
  const abort = useCallback(async (): Promise<void> => {
    const conversation = conversationIdRef.current;
    if (!conversation) {
      return;
    }
    setAbortError(undefined);
    setAborting(true);
    try {
      await abortAiConversation(conversation);
      // ⚠️ **乐观解禁**：不等服务端的 `agent_settled` 帧。
      //    万一那一帧丢了（断线），界面会永远停在「本轮进行中…」。
      settle();
    } catch (error) {
      setAbortError(toMessage(error));
    } finally {
      setAborting(false);
    }
  }, [settle]);

  /** 批准一条挂起的修改。 */
  const approvePending = useCallback(async (id: string): Promise<void> => {
    try {
      await approveAiPending(id);
    } catch (error) {
      setSendError(toMessage(error));
    }
  }, []);

  /** 拒绝一条挂起的修改。 */
  const rejectPending = useCallback(async (id: string): Promise<void> => {
    try {
      await rejectAiPending(id);
    } catch (error) {
      setSendError(toMessage(error));
    }
  }, []);

  return {
    conversationId,
    model,
    messages,
    thinking,
    pendingItems,
    streaming,
    connected,
    aiUnavailable,
    sending,
    sendError,
    connectionError,
    send,
    retry,
    reconnect,
    newConversation,
    switchConversation,
    abort,
    aborting,
    abortError,
    approvePending,
    rejectPending,
  };
}
