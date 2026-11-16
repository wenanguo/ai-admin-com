/**
 * 项目详情页的**成员页签**。
 *
 * ## 为什么单独一个文件
 *
 * 以前它住在 `detail.tsx` 里 ⇒ 想给它写单测就得把整个详情页（连带甘特图、
 * 三个页签的视图）都拉进来 ⇒ 测试又重又脆。
 * ⇒ 抽成独立组件：**只测这一块**。
 *
 * ## 接口形状
 *
 * `getProjectMembers` 是**路径参数**接口（`/pm_project/pm_project/members/{id}`），
 * 返回的是**数组**（带 `user_info` 冗余），**不是**分页信封 ⇒ `res?.data ?? []`。
 */
import { Table, type TableProps } from 'antd';
import { useEffect, useState } from 'react';
import { DictTag } from '@/components/pm/DictTag';
import {
  getProjectMembers,
  type ProjectMemberOut,
} from '@/services/api/pm/project';

/**
 * 成员页签。
 *
 * ⚠️ **要有载入指示**（issue #66）：以前请求期间表格一片空白
 * ⇒ 用户看着像「这个项目没有成员」⇒ 用 antd Table 原生的 `loading`。
 * （`loading` 与「确实没有成员」天然区分得开：前者转圈，后者显示空状态。）
 */
export function MembersTab({ projectId }: { projectId: number }) {
  const [members, setMembers] = useState<ProjectMemberOut[]>([]);
  /** 请求期间为 true ⇒ 表格转圈 */
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProjectMembers(projectId)
      .then((res) => {
        if (!cancelled) setMembers(res?.data ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const columns: TableProps<ProjectMemberOut>['columns'] = [
    {
      title: '成员',
      dataIndex: 'user_id',
      render: (_, record) =>
        record.user_info?.name ?? record.user_info?.username ?? '-',
    },
    {
      title: '角色',
      dataIndex: 'role_code',
      render: (_, record) =>
        record.role_code ? (
          <DictTag dictType="module_pm_project_role" value={record.role_code} />
        ) : (
          '-'
        ),
    },
    {
      title: '加入时间',
      dataIndex: 'joined_at',
      // 后端 datetime 序列化成 ISO(带 T),展示时换成空格
      render: (_, record) =>
        record.joined_at ? record.joined_at.replace('T', ' ') : '-',
    },
  ];

  return (
    <Table<ProjectMemberOut>
      rowKey="id"
      columns={columns}
      dataSource={members}
      loading={loading}
    />
  );
}
