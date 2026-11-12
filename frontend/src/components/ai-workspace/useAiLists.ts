/**
 * 待确认与审计两个页签的**读侧数据**。
 *
 * 两个端点都是**只读**的：
 * - `GET /api/pending` —— 待确认的行；
 * - `GET /api/audit` —— 审计的行。
 *
 * ⚠️ 服务端**没有**确认/撤销的写入口 ⇒ 这里只负责取回与出错兜底，
 * **不发任何写请求**（发了就是 404）。
 *
 * ## 为什么要「按需读」
 *
 * 面板是**浮层**（点开才挂载）⇒ 每次打开任何页面**不一定会**挂载它。
 * 若这里一上来就把两个列表都读一遍：
 * - 用户根本没点那两个页签，也白发两次请求；
 * - AI 服务不可达时，全局请求错误处理还会弹一次提示 ⇒ 用户在别的页面上
 *   莫名其妙看到「AI 读不到」的红条。
 *
 * ⇒ 只在**页签真的被打开**时读（`enabled`）。
 */
import { useCallback, useEffect, useState } from 'react';
import { listAiAudit, listAiPending } from '@/services/api/ai/client';
import type { AiAuditRow, AiPendingRow } from '@/services/api/ai/types';

/** hook 的入参。 */
export interface UseAiListsOptions {
  /** 要不要读待确认（页签没打开就不读）。 */
  pending?: boolean;
  /** 要不要读审计（页签没打开就不读）。 */
  audit?: boolean;
}

/** 两个列表的读侧状态。 */
export interface AiLists {
  /** 待确认的行。 */
  pending: AiPendingRow[];
  /** 待确认还在读。 */
  pendingLoading: boolean;
  /** 待确认读失败了。 */
  pendingError?: string;
  /** 审计的行（新的在前）。 */
  audit: AiAuditRow[];
  /** 审计还在读。 */
  auditLoading: boolean;
  /** 审计读失败了。 */
  auditError?: string;
  /** **重读**两个列表（批准/拒绝之后要刷新）。 */
  reload: () => void;
}

/** 未知错误转成一句话。 */
function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '读取失败';
}

/**
 * 取回待确认与审计两页的数据（页签打开了才读）。
 *
 * ⚠️ **读失败不许把面板搞崩**（规格 §3.10：AI 挂了系统不瘫）⇒ 失败只落到
 * 页面上的一个错误提示里。
 *
 * @param options 哪些列表要读。
 */
export function useAiLists({
  pending: pendingEnabled = false,
  audit: auditEnabled = false,
}: UseAiListsOptions = {}): AiLists {
  const [pending, setPending] = useState<AiPendingRow[]>([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [pendingError, setPendingError] = useState<string | undefined>(
    undefined,
  );
  const [audit, setAudit] = useState<AiAuditRow[]>([]);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditError, setAuditError] = useState<string | undefined>(undefined);
  /** 重读的触发器（批准/拒绝之后要刷新列表）。 */
  const [reloadToken, setReloadToken] = useState(0);

  /** 重读两个列表。 */
  const reload = useCallback(() => {
    setReloadToken((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (!pendingEnabled) {
      return;
    }
    let disposed = false;

    void listAiPending()
      .then((rows) => {
        if (!disposed) {
          setPending(Array.isArray(rows) ? rows : []);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setPendingError(toMessage(error));
        }
      })
      .finally(() => {
        if (!disposed) {
          setPendingLoaded(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, [pendingEnabled, reloadToken]);

  useEffect(() => {
    if (!auditEnabled) {
      return;
    }
    let disposed = false;

    void listAiAudit()
      .then((page) => {
        if (!disposed) {
          setAudit(Array.isArray(page?.items) ? page.items : []);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setAuditError(toMessage(error));
        }
      })
      .finally(() => {
        if (!disposed) {
          setAuditLoaded(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, [auditEnabled, reloadToken]);

  return {
    pending,
    pendingLoading: pendingEnabled && !pendingLoaded,
    pendingError,
    audit,
    auditLoading: auditEnabled && !auditLoaded,
    auditError,
    reload,
  };
}
