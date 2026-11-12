import { CommentOutlined } from '@ant-design/icons';
import { useAccess, useModel } from '@umijs/max';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Spin,
  theme,
} from 'antd';
import dayjs from 'dayjs';
import type React from 'react';
import { useCallback, useState } from 'react';
import { buildAiTaskContext, mergeDictLabels } from '@/components/pm/aiContext';
import { DictTag } from '@/components/pm/DictTag';
import { useAiTaskUpdate } from '@/components/pm/useAiTaskUpdate';
import { useDictOptions } from '@/components/pm/useDictOptions';
import { useProjectNames } from '@/components/pm/useProjectNames';
import type { TaskOut } from '@/services/api/pm/task';
import { type BoardStatus, useBoardColumns } from './useBoardColumns';

/**
 * 任务看板 —— **视图**（不是页面了）。
 *
 * 现在它挂在任务页面的 Segmented 上（`TaskWorkspace`）⇒
 * 与列表/甘特共用**同一份数据**（`useTaskDataset`）⇒ 切过来不用重新取数。
 *
 * 六列(待规划/待办/进行中/阻塞/评审/已完成),**已取消的任务不进看板** ——
 * 取消掉的任务已经退出工作流,取消操作走列表页的编辑弹窗。
 *
 * 拖拽用**浏览器原生的 HTML5 拖放**(draggable / dragstart / dragover / drop):
 * 项目里没有装拖拽库,原生拖放够用,也不必为一个页面引一个依赖。
 * 拖拽**只改 status_code 一个维度**,写的是整对象 PUT,写失败卡片回原列 ——
 * 细节见 useBoardColumns。
 */

/** 今天(本地日期,YYYY-MM-DD) */
function today(): string {
  return dayjs().format('YYYY-MM-DD');
}

/**
 * 截止日是否已过。
 *
 * 后端给的是 `date`(YYYY-MM-DD 字符串),今天也取**本地**日期的同样格式 ——
 * ISO 日期的字典序就是时间序,直接比字符串就行。
 */
function isOverdue(dueDate?: string | null): boolean {
  if (!dueDate) return false;
  return dueDate < today();
}

/** 看板卡片:标题 + 优先级标签 + 负责人 + 估时 + 截止日(逾期标红) */
function TaskCard({
  task,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  onDiscuss,
}: {
  task: TaskOut;
  /** 能不能拖(没有 update 权限就不给拖) */
  draggable: boolean;
  /** 是不是正在被拖的那张(半透明,好知道拖的是哪张) */
  dragging: boolean;
  onDragStart: (task: TaskOut, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  /** 「与 AI 讨论」
   */
  onDiscuss?: (task: TaskOut) => void;
}) {
  const { token } = theme.useToken();
  const assignee = task.assignee_by?.name ?? null;
  const overdue = isOverdue(task.due_date);

  return (
    <Card
      size="small"
      draggable={draggable}
      onDragStart={(event) => onDragStart(task, event)}
      onDragEnd={onDragEnd}
      data-task-id={task.id}
      className={dragging ? 'opacity-50' : undefined}
    >
      <div className="flex flex-col gap-2">
        <div className="font-medium">{task.title ?? '-'}</div>
        <div className="flex flex-wrap items-center gap-2">
          <DictTag dictType="module_pm_priority" value={task.priority_code} />
          {assignee ? (
            <span className="flex items-center gap-1">
              {/* Avatar 自己也是可拖的,关掉它,免得拖卡片时拖到头像上 */}
              <Avatar size="small" draggable={false}>
                {assignee.slice(0, 1)}
              </Avatar>
              <span>{assignee}</span>
            </span>
          ) : null}
          {task.estimate_hours != null ? (
            <span>估时 {task.estimate_hours}h</span>
          ) : null}
          {task.due_date ? (
            <span style={overdue ? { color: token.colorError } : undefined}>
              {task.due_date}
            </span>
          ) : null}
          {onDiscuss ? (
            <Button
              type="link"
              size="small"
              icon={<CommentOutlined />}
              className="ml-auto"
              // ⚠️ **别让这次按下变成拖拽**:卡片整体是 draggable 的
              //   ⇒ 按下按钮也会开始拖 ⇒ 松手就变成「改状态」了
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={() => onDiscuss(task)}
            >
              讨论
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * 任务看板页。
 *
 * 看板是「读 + 改状态」的面:读要 `module_pm_project:pm_task:query`,
 * 拖拽(改状态)要 `module_pm_project:pm_task:update` —— 没有 update 的角色
 * 看得到卡片,但拖不动。
 */
/** 看板视图的 props */
export interface TaskBoardProps {
  /** 限定到某个项目（项目详情页的任务页签用） */
  projectId?: number;
}

/**
 * 任务看板视图。
 *
 * @param props.projectId 限定项目；不传就是全部
 */
export function TaskBoard({ projectId }: TaskBoardProps): React.ReactElement {
  const access = useAccess();
  const { columns, loading, total, truncated, moveTask, reload } =
    useBoardColumns({ projectId });
  /** AI 工作台 ↔ 主工作区的桥 */
  const aiBridge = useModel('ai-bridge');
  /** 侧载的项目/里程碑名字（讨论上下文里要带「所属项目 / 所属里程碑」） */
  const { projectNames, milestoneNames } = useProjectNames();
  /** 状态字典（上下文里要给「线上码（中文）」） */
  const { options: statusOptions } = useDictOptions('module_pm_task_status');

  /**
   * 「与 AI 讨论」：把这一张卡片设为当前讨论对象。
   *
   * ⚠️ 上下文由前端组装（不发请求）—— 卡片上的数据就是用户看到的那份。
   */
  const discussTask = useCallback(
    (task: TaskOut) => {
      const context = buildAiTaskContext({
        task,
        projectName:
          task.project_id == null
            ? undefined
            : projectNames.get(task.project_id),
        milestoneName:
          task.milestone_id == null
            ? undefined
            : milestoneNames.get(task.milestone_id),
        labels: mergeDictLabels(statusOptions),
      });
      if (!context) {
        return;
      }
      aiBridge.setContext(context);
      aiBridge.requestExpand();
      // ⚠️ 顺便切到「对话」页签：点完「讨论」就该**马上能说话**
      aiBridge.requestFocus();
    },
    [aiBridge, milestoneNames, projectNames, statusOptions],
  );

  /** AI 写回成功 ⇒ 刷新看板 */
  const { rowClassName } = useAiTaskUpdate(reload);

  // 拖拽要 update 权限
  const canDrag = access.hasPermission('module_pm_project:pm_task:update');

  /**
   * 正在被拖的卡片 id。
   *
   * 拖起(dragstart)时记下,落下(drop)时取用 —— 拖放是同一次交互里的两个事件,
   * 用 React 状态串起来比读 dataTransfer 更直白。
   */
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const handleDragStart = (
    task: TaskOut,
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    // dataTransfer 要有内容:部分浏览器据此判定「拖起来了」
    event.dataTransfer.setData('text/plain', String(task.id ?? ''));
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(task.id ?? null);
  };

  // 拖到列外松手也会走这里(收尾,别把状态留在「正在拖」)
  const handleDragEnd = () => setDraggingId(null);

  // 不阻止默认行为,浏览器就不会派发 drop 事件
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (
    status: BoardStatus,
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const taskId = draggingId;
    setDraggingId(null);
    if (taskId == null) return;
    // 写失败由 moveTask 自己回滚,这里不用管
    void moveTask(taskId, status);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ⚠️ **这里不写标题**:工作台顶上有「任务管理」+ Segmented ⇒ 再写一个
          「任务看板」就是同一个地方两个标题。 */}
      {truncated ? (
        <Alert
          type="info"
          showIcon
          title={`看板只拉了前 100 个任务(共 ${total} 个),其余请到「任务管理」页查看`}
          description="已取消(cancelled)的任务不进看板 —— 看板上的卡片会比拉到的条数更少。"
        />
      ) : null}
      {loading ? (
        <div className="flex justify-center py-10">
          <Spin />
        </div>
      ) : (
        <Row gutter={[16, 16]}>
          {columns.map((column) => (
            <Col key={column.status} xs={24} sm={12} lg={8} xl={4}>
              <div
                data-column={column.status}
                onDragOver={handleDragOver}
                onDrop={(event) => handleDrop(column.status, event)}
                className="flex h-full flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2"
              >
                <div
                  data-column-head={column.status}
                  className="flex items-center justify-between px-1 font-medium"
                >
                  <span>{column.title}</span>
                  <span className="text-sm text-neutral-500">
                    {column.tasks.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {column.tasks.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无任务"
                    />
                  ) : (
                    column.tasks.map((task) => (
                      <TaskCard
                        key={String(task.id ?? task.title ?? '')}
                        task={task}
                        draggable={canDrag}
                        dragging={draggingId === task.id}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDiscuss={discussTask}
                      />
                    ))
                  )}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
