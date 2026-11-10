import { PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, Button, Tag } from 'antd';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import { DictTag } from '@/components/pm/DictTag';
import {
  RISK_LEVEL_COLOR,
  riskLevel,
  riskLevelLabel,
} from '@/components/pm/riskLevel';
import { toValueEnum } from '@/components/pm/toValueEnum';
import { useDictOptions } from '@/components/pm/useDictOptions';
import { listProjects } from '@/services/api/pm/project';
import type { RiskCreateParams, RiskOut } from '@/services/api/pm/risk';
import {
  createRisk,
  deleteRisks,
  listRisks,
  updateRisk,
} from '@/services/api/pm/risk';
import { listUsers } from '@/services/api/system/user';
import { toProTableRequest } from '@/services/paginate';
import RiskHeatmap, { type RiskCell } from './Heatmap';
import RiskModalForm from './ModalForm';

const requestRisks = toProTableRequest<RiskOut>(listRisks);

/** 侧载一次的上限:后端 page_size 最大 100(同 CRUD_PAGINATION) */
const SIDE_LOAD_PARAMS = {
  page_no: 1,
  page_size: 100,
  // 排序显式写出来:后端的默认排序也是 id 倒序,但写出来才能保证
  // 「侧载到的是最新的 100 条」是构造出来的,而不是后端改了默认值才知道
  order_by: JSON.stringify([{ id: 'desc' }]),
} as const;

/** 项目下拉选项(label 给人看,value 是项目 id) */
interface ProjectOption {
  label: string;
  value: number;
}

/**
 * 项目名的**侧载**。
 *
 * 风险的响应里没有 project_by,只有 project_id —— 名字要自己把项目表
 * 拉下来做映射。三条纪律(与任务页的侧载同款):
 * 1. **一次**:挂载时拉一次,不是在每行的 render 里发请求
 * 2. **查表**:列的 render 只做 Map 查表
 * 3. **降级**:拉失败只是没有名字(失败提示由请求层统一弹,这里不抛)
 *
 * ⚠️ 侧载有上限(后端 page_size 最大 100):这里取的是**最新的** 100 个项目,
 * 更早的项目在表格里只能看到 id(见 lookupProjectName)。上限**不静默**:
 * 后端的总数会带出去,页面据此给提示。
 */
function useProjectSideLoad(): {
  names: Map<number, string>;
  options: ProjectOption[];
  /** 后端一共多少个项目 */
  total: number;
} {
  const [options, setOptions] = useState<ProjectOption[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listProjects(SIDE_LOAD_PARAMS)
      .then((res) => {
        if (cancelled) return;
        const next: ProjectOption[] = [];
        for (const project of res?.data?.items ?? []) {
          if (project.id == null) continue;
          next.push({
            label: project.name ?? String(project.id),
            value: project.id,
          });
        }
        setOptions(next);
        setTotal(res?.data?.total ?? 0);
      })
      .catch(() => {
        // 失败提示由请求层统一弹,这里降级成空选项
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const names = useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options],
  );

  return { names, options, total };
}

/**
 * 项目 id → 名字(侧载的映射表里查;查不到退回 id,再查不到显示占位符)。
 */
function lookupProjectName(
  names: Map<number, string>,
  id?: number | null,
): string {
  if (id == null) return '-';
  return names.get(id) ?? String(id);
}

/**
 * 风险登记册页 —— 路由 /pm/risk(菜单由后端下发,目录挂在 /pm 下)。
 *
 * 上面是 5×5 **热力图**(横轴影响、纵轴概率,每格是落在该格的风险数,
 * 颜色取该格最高分对应的等级),下面是风险列表;点格子过滤列表。
 *
 * 骨架逻辑(操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」,与其它模块同范式。
 *
 * 一个特别之处:**等级是派生量** —— 后端只存 score(= 概率 × 影响),
 * 没有 level 字段,等级一律用共享件 riskLevel 现算(不在这页另写一套阈值)。
 */
const RiskRegister: React.FC = () => {
  const access = useAccess();

  const crud = useCrudTable<RiskOut, RiskCreateParams>({
    create: createRisk,
    update: updateRisk,
    remove: deleteRisks,
  });

  // 侧载的项目名字:一次拉,列里查表映射成名字
  const {
    names: projectNames,
    options: projectOptions,
    total: projectTotal,
  } = useProjectSideLoad();

  // 字典选项:表格标签(DictTag 内部也用它)与搜索下拉(valueEnum)共用,
  // useDictOptions 有模块级缓存,这里两个类型各只发一次请求
  const { options: categoryOptions } = useDictOptions(
    'module_pm_risk_category',
  );
  const { options: statusOptions } = useDictOptions('module_pm_risk_status');

  const categoryValueEnum = useMemo(
    () => toValueEnum(categoryOptions),
    [categoryOptions],
  );
  const statusValueEnum = useMemo(
    () => toValueEnum(statusOptions),
    [statusOptions],
  );

  /**
   * 热力图要统计**全部**风险(不是当前页),所以单独拉一次。
   *
   * 后端 page_size 上限 100 ⇒ 超过 100 条时热力图只统计前 100 条,
   * 页面会给一条提示(与任务看板页的处理同款)。
   */
  const [allRisks, setAllRisks] = useState<RiskOut[]>([]);
  const [allTotal, setAllTotal] = useState(0);

  const loadAllRisks = useCallback(() => {
    listRisks(SIDE_LOAD_PARAMS)
      .then((res) => {
        setAllRisks(res?.data?.items ?? []);
        setAllTotal(res?.data?.total ?? 0);
      })
      .catch(() => {
        // 失败提示由请求层统一弹,这里降级成空热力图
      });
  }, []);

  useEffect(() => {
    loadAllRisks();
  }, [loadAllRisks]);

  /** 热力图上选中的格子(null = 不过滤) */
  const [cell, setCell] = useState<RiskCell | null>(null);
  const handleSelectCell = useCallback((next: RiskCell | null) => {
    setCell(next);
  }, []);

  const columns: ProColumns<RiskOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '风险标题',
      dataIndex: 'title',
      width: 220,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '所属项目',
      dataIndex: 'project_id',
      width: 160,
      valueType: 'select',
      // 搜索下拉的候选来自侧载的项目列表(页面已经拉过,不再发请求)
      fieldProps: { options: projectOptions, showSearch: true },
      // 表格里显示的是侧载映射出来的项目名(响应里没有 project_by)
      render: (_, record) => lookupProjectName(projectNames, record.project_id),
    },
    {
      title: '分类',
      dataIndex: 'category_code',
      width: 100,
      valueEnum: categoryValueEnum,
      render: (_, record) => (
        <DictTag
          dictType="module_pm_risk_category"
          value={record.category_code}
        />
      ),
    },
    {
      // 概率与影响不进搜索栏:热力图就是它们的筛选器(两个维度要一起选)
      title: '概率',
      dataIndex: 'probability',
      width: 80,
      search: false,
      render: (_, record) => record.probability ?? '-',
    },
    {
      title: '影响',
      dataIndex: 'impact',
      width: 80,
      search: false,
      render: (_, record) => record.impact ?? '-',
    },
    {
      title: '分数',
      dataIndex: 'score',
      width: 80,
      search: false,
      render: (_, record) => record.score ?? '-',
    },
    {
      /*
        等级是**派生量**:后端只有 score(= 概率 × 影响),没有 level 字段 ——
        阈值在共享件 riskLevel 里,这一列只负责把分数翻译成等级标签。
        (刻意不给 dataIndex:分数列已经用了 score,两列不能共用一个键)
      */
      title: '等级',
      key: 'level',
      width: 90,
      search: false,
      render: (_, record) => {
        if (record.score == null) return '-';
        const level = riskLevel(record.score);
        return (
          <Tag color={RISK_LEVEL_COLOR[level]}>{riskLevelLabel(level)}</Tag>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status_code',
      width: 110,
      valueEnum: statusValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_risk_status" value={record.status_code} />
      ),
    },
    {
      title: '负责人',
      dataIndex: 'owner_id',
      width: 130,
      valueType: 'select',
      // ⚠️ 列级 select 必须显式开 showSearch,否则远程搜索是死代码
      // (rc-select 的输入框 readOnly,onSearch 永远不触发) —— 见工单页处理人列
      fieldProps: { showSearch: true },
      // 远程搜索防抖(毫秒);ProComponents 的默认是 0,每敲一个字发一次请求
      debounceTime: 300,
      /*
        搜索项:负责人是用户,候选来自 listUsers,按姓名远程搜。
        ⚠️ 这个接口在后端要 module_system:user:query 权限;
        没有这个权限时只有这一项搜索用不了,列表本身不受影响。
      */
      request: async ({ keyWords }: { keyWords?: string }) => {
        const keyword = keyWords?.trim();
        const res = await listUsers({
          page_no: 1,
          page_size: 100,
          ...(keyword ? { name: keyword } : {}),
        });
        return (res?.data?.items ?? []).flatMap((user) =>
          user.id == null
            ? []
            : [
                {
                  label: user.name ?? user.username ?? String(user.id),
                  value: user.id,
                },
              ],
        );
      },
      // 表格里读后端随行返回的 owner_by 冗余字段,不用再查用户表
      render: (_, record) => record.owner_by?.name ?? '-',
    },
    {
      title: '缓解措施截止',
      dataIndex: 'due_date',
      width: 140,
      search: false,
      render: (_, record) => record.due_date ?? '-',
    },
    {
      /*
        创建方式没有字典(风险模块的字典只有分类与状态;库里这一列的值是
        manual / ai_suggested),所以显示原值,不套 DictTag。
      */
      title: '创建方式',
      dataIndex: 'created_via_code',
      width: 110,
      search: false,
      render: (_, record) => record.created_via_code ?? '-',
    },
  ];

  const operationColumns = useCrudColumns<RiskOut>({
    onEdit: crud.openEdit,
    onDelete: async (record) => {
      await crud.handleDelete(record);
      // 热力图统计的是全量风险,删除后要重新拉一次
      loadAllRisks();
    },
    editPerm: 'module_pm_risk:pm_risk:update',
    deletePerm: 'module_pm_risk:pm_risk:delete',
    entityName: '风险',
  });

  return (
    <div className="flex flex-col gap-4">
      <RiskHeatmap
        risks={allRisks}
        selected={cell}
        onSelect={handleSelectCell}
      />
      {allTotal > allRisks.length ? (
        <Alert
          type="info"
          showIcon
          title={`热力图最多统计前 ${allRisks.length} 条风险(共 ${allTotal} 条),其余请到下面的列表里翻页查看`}
        />
      ) : null}
      {/*
        项目名的侧载也有上限:后端 page_size 最大 100,这里取的是最新的 100 个
        项目 ⇒ 更早的项目在表格里显示为 id。这条上限不静默,给一条提示。
        标题说**上限**(后端一次最多给 100 个),描述说**实际拿到几个** ——
        两句分开说才不互相打架。
      */}
      {projectTotal > projectOptions.length ? (
        <Alert
          type="info"
          showIcon
          title="项目名来自侧载列表,后端一次最多给 100 个"
          description={`后端一共 ${projectTotal} 个项目,侧载只拿到最新的 ${projectOptions.length} 个,更早的项目在表格里显示为项目 id。`}
        />
      ) : null}
      <ProTable<RiskOut>
        headerTitle="风险登记册"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestRisks}
        // 热力图选中的格子 = 列表的过滤条件(后端就是按这两个字段等值过滤的)
        params={
          cell
            ? { probability: cell.probability, impact: cell.impact }
            : undefined
        }
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        // (内容区被右侧的 AI 工作台占掉一块,列宽被压到最小就会这样)
        scroll={{ x: 'max-content' }}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!access.hasPermission('module_pm_risk:pm_risk:create')}
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <RiskModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={async (values) => {
          const ok = await crud.handleSubmit(values);
          // 热力图统计的是全量风险,写操作之后要重新拉一次
          if (ok) loadAllRisks();
          return ok;
        }}
      />
    </div>
  );
};

export default RiskRegister;
