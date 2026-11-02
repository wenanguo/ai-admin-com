import { TreeSelect, type TreeSelectProps, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { DeptOut } from '@/services/api/system/dept';
import { getDeptTree } from '@/services/api/system/dept';
import { isApiResponse } from '@/services/response';

/**
 * 部门树选择器 —— 跨模块复用的共用组件。
 *
 * 消费者:部门页(选上级部门)、角色页(自定义数据权限)、用户表单(选所属部门)。
 * 组件本身**零业务耦合**:数据源只有一个(GET /system/dept/tree),
 * 交互只有「选一个部门 id」。
 */

/** TreeSelect 的节点类型(从 antd 的 props 里取,不深导入 antd 内部路径) */
type DeptTreeNode = NonNullable<TreeSelectProps<number>['treeData']>[number];

/** 加载失败的原因 */
type LoadError = 'forbidden' | 'failed';

/** 每种失败原因的默认行内提示 */
const DEFAULT_HINTS: Record<LoadError, string> = {
  forbidden: '没有查看部门的权限,无法选择部门',
  failed: '部门列表加载失败,请稍后重试',
};

export interface DeptTreeSelectProps {
  /** 选中的部门 id */
  value?: number | null;
  /** 选中变化(清空时回传 undefined) */
  onChange?: (value: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /** 排除某个节点及其子树(选父部门时用来防自引用) */
  excludeId?: number;
  /** 加载失败时的行内提示(不传则按失败原因给默认文案) */
  errorHint?: string;
}

/**
 * 部门树 → TreeSelect 的 treeData。
 *
 * `excludeId` 命中的节点**连同它的整棵子树**一起剪掉 ——
 * 选上级部门时不能把自己(或自己的下级)选成父部门,否则会造出环。
 */
function buildTreeData(
  nodes: DeptOut[],
  excludeId: number | undefined,
): DeptTreeNode[] {
  const result: DeptTreeNode[] = [];

  for (const node of nodes) {
    // 没有 id 的节点没法当选项(选中值是 id)
    if (node.id == null) continue;
    // 被排除的节点整棵子树都不出现
    if (excludeId !== undefined && node.id === excludeId) continue;

    const children = buildTreeData(node.children ?? [], excludeId);
    result.push({
      title: node.name ?? node.code ?? String(node.id),
      value: node.id,
      ...(children.length > 0 ? { children } : {}),
    });
  }

  return result;
}

/**
 * 这次失败是不是「没有权限」。
 *
 * - 请求层把后端的业务信封转成 BizError,信封在 `error.info` 里(业务码 403)
 * - 没有信封的裸 HTTP 错误(axios 的 403)在 `error.response.status` 里
 */
function isForbidden(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  if ('info' in error && isApiResponse(error.info) && error.info.code === 403) {
    return true;
  }

  if ('response' in error) {
    const { response } = error;
    return (
      typeof response === 'object' &&
      response !== null &&
      'status' in response &&
      response.status === 403
    );
  }

  return false;
}

/**
 * 部门树选择器。
 *
 * - 数据源:`GET /system/dept/tree`(后端没有部门列表接口,只有树)
 * - 请求失败时降级为「没有选项」,**不抛异常**
 * - 失败**不走全局错误处理**(skipErrorHandler):
 *   部门树接口要 `module_system:dept:query` 权限,只有用户管理权限的角色
 *   打开用户弹窗时会被后端拒掉 —— 这种「本来就没给的权限」不该弹全局 toast,
 *   组件降级成空下拉 + 一行行内提示就够了(真正的网络错误会走到「加载失败」那句提示)
 */
export default function DeptTreeSelect({
  value,
  onChange,
  placeholder = '请选择部门',
  disabled,
  allowClear = true,
  excludeId,
  errorHint,
}: DeptTreeSelectProps) {
  const [depts, setDepts] = useState<DeptOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getDeptTree({ skipErrorHandler: true })
      .then((res) => {
        if (cancelled) return;
        setDepts(res?.data ?? []);
      })
      .catch((error: unknown) => {
        // 降级成「没有选项」,组件照常渲染
        if (cancelled) return;
        setDepts([]);
        setLoadError(isForbidden(error) ? 'forbidden' : 'failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const treeData = useMemo(
    () => buildTreeData(depts, excludeId),
    [depts, excludeId],
  );

  const hint = loadError ? (errorHint ?? DEFAULT_HINTS[loadError]) : null;

  return (
    <>
      <TreeSelect<number | undefined>
        value={value ?? undefined}
        // 包一层:对外的契约是「回传部门 id」,不透传 antd 的 labelList / extra
        onChange={(next) => onChange?.(next)}
        placeholder={placeholder}
        disabled={disabled}
        allowClear={allowClear}
        loading={loading}
        treeData={treeData}
        treeDefaultExpandAll
        showSearch={{ treeNodeFilterProp: 'title' }}
        style={{ width: '100%' }}
      />
      {hint && (
        <Typography.Text
          type="secondary"
          style={{ display: 'block', marginTop: 4, fontSize: 12 }}
        >
          {hint}
        </Typography.Text>
      )}
    </>
  );
}
