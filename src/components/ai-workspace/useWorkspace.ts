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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAiCommandId,
  createAiConversation,
  getAiState,
  sendAiCommand,
} from '@/services/api/ai/client';
import { readWorkspaceStorage, writeWorkspaceStorage } from './storage';
import type { ChatMessage } from './useAgentStream';
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
  /** 气泡列表。 */
  messages: ChatMessage[];
  /** 本轮是否在进行中。 */
  streaming: boolean;
  /** 事件流是不是连着的。 */
  connected: boolean;
  /** 命令还在发出去（还没被受理）。 */
  sending: boolean;
  /** 上一条命令发送失败的原因。 */
  sendError?: string;
  /**
   * 会话建不起来的原因（AI 服务不可达之类）。
   *
   * ⚠️ 侧栏常驻在每个页面上 ⇒ AI 服务不可达是**全局**状态，
   * 显示在面板里，而不是弹一次全局提示（那个会在每个页面上重复出现）。
   */
  connectionError?: string;
  /** 发送一句话。 */
  send: (text: string) => Promise<void>;
  /** 重试上一条失败的消息（**复用同一个命令 id**）。 */
  retry: () => Promise<void>;
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
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined,
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  /** 会话建不起来的原因（AI 服务不可达之类）。 */
  const [connectionError, setConnectionError] = useState<string | undefined>(
    undefined,
  );
  /** 上一条命令（重试时要复用它的 id）。 */
  const lastCommandRef = useRef<{ id: string; text: string } | undefined>(
    undefined,
  );
  /** 当前会话 id 的副本：发送是异步的，要读**最新**的值。 */
  const conversationIdRef = useRef<string | undefined>(undefined);
  /** 会话就绪的信号：会话建好（或建不出来）之后 resolve。 */
  const readyRef = useRef<Promise<void> | undefined>(undefined);

  const { messages, streaming, connected, appendUserMessage, restore } =
    useAgentStream({
      conversationId,
    });

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
        // 侧栏是常驻在每个页面上的，服务没起来时不该在每个页面上都弹一次。
        // 失败的原因显示在侧栏面板里（`connectionError`）。
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
  }, [restore, storageKey]);

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
        await sendAiCommand(conversation, text, { id });
      } catch (error) {
        setSendError(toMessage(error));
      } finally {
        setSending(false);
      }
    },
    [],
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

  return {
    conversationId,
    messages,
    streaming,
    connected,
    sending,
    sendError,
    connectionError,
    send,
    retry,
  };
}
