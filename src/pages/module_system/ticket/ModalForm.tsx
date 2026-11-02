import {
  ModalForm,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type {
  TicketCreateParams,
  TicketOut,
  TicketStatus,
  TicketType,
} from '@/services/api/system/ticket';

export type TicketModalProps = {
  open: boolean;
  record?: TicketOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TicketCreateParams) => Promise<boolean>;
};

/**
 * 工单类型的候选项。
 *
 * ⚠️ value 是**提交给后端的值**,label 只是给管理员看的文案:
 *    后端 `TicketTypeEnum` 只有 suggestion / bug / optimize / other 四个值
 *    (`backend/app/common/enums.py`),提交中文标签一律 422。
 */
const TICKET_TYPE_OPTIONS: { label: string; value: TicketType }[] = [
  { label: '建议', value: 'suggestion' },
  { label: '缺陷', value: 'bug' },
  { label: '优化', value: 'optimize' },
  { label: '其他', value: 'other' },
];

/**
 * 工单状态 —— 后端 `TicketBatchSchema.status` 的 0..3
 * (0 待处理 / 1 处理中 / 2 已完成 / 3 已关闭)。
 *
 * 表格的「状态」列也用这组取值(见 index.tsx 的 valueEnum),
 * 两处共用这一份文案。
 */
export const TICKET_STATUS_OPTIONS: { label: string; value: TicketStatus }[] = [
  { label: '待处理', value: 0 },
  { label: '处理中', value: 1 },
  { label: '已完成', value: 2 },
  { label: '已关闭', value: 3 },
];

/**
 * 把后端返回的 ticket_type 收窄成 TicketType。
 *
 * 后端的响应模型用的是同一个枚举,正常只可能是那四个值;
 * 万一遇到别的值,宁可当成「没填」,也不要把它原样塞进表单 ——
 * 表单提交的是 TicketType,塞一个非法字符串过去必然 422。
 */
function toTicketType(value: TicketOut['ticket_type']): TicketType | undefined {
  switch (value) {
    case 'suggestion':
    case 'bug':
    case 'optimize':
    case 'other':
      return value;
    default:
      return undefined;
  }
}

const TicketModalForm: React.FC<TicketModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<TicketCreateParams>
      title={record?.id ? '编辑工单' : '新增工单'}
      open={open}
      initialValues={{
        title: record?.title ?? undefined,
        ticket_type: toTicketType(record?.ticket_type),
        ticket_content: record?.ticket_content ?? undefined,
        summary: record?.summary ?? undefined,
        images: record?.images ?? undefined,
        description: record?.description ?? undefined,
      }}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(values);
      }}
    >
      <ProFormText
        name="title"
        label="工单标题"
        rules={[{ required: true, message: '请输入工单标题' }]}
      />
      <ProFormSelect
        name="ticket_type"
        label="工单类型"
        options={TICKET_TYPE_OPTIONS}
        rules={[{ required: true, message: '请选择工单类型' }]}
      />
      <ProFormTextArea
        name="ticket_content"
        label="工单内容"
        fieldProps={{ rows: 4 }}
        rules={[{ required: true, message: '请输入工单内容' }]}
      />
      <ProFormTextArea
        name="summary"
        label="内容摘要"
        fieldProps={{ rows: 2 }}
      />
      <ProFormText
        name="images"
        label="图片链接"
        // 后端 images 存的是「图片 URL 的 JSON 数组」这一串文本
        fieldProps={{
          placeholder: '图片 URL 的 JSON 数组,如 ["https://example.com/a.png"]',
        }}
      />
      <ProFormTextArea
        name="description"
        label="描述"
        fieldProps={{ rows: 3 }}
      />
    </ModalForm>
  );
};

export type TicketBatchModalProps = {
  open: boolean;
  /** 待批量更新的工单条数(标题里显示) */
  count: number;
  onOpenChange: (open: boolean) => void;
  /** 返回 true 表示成功(弹窗关闭),false 表示失败(弹窗保持打开) */
  onSubmit: (status: TicketStatus) => Promise<boolean>;
};

/** 批量更新表单的字段 —— 后端 TicketBatchSchema 的 status(0..3) */
type TicketBatchFormValues = {
  status: TicketStatus;
};

/**
 * 批量更新工单**状态**的弹窗 —— PUT /system/ticket/batch。
 *
 * 后端的批量更新**不是**「批量改任意字段」,而是「批量改状态」:
 * 入参只有 `{ ids, status }` 两个平级字段(`TicketBatchSchema`),
 * 方法是 PUT(不是 PATCH)。
 */
const TicketBatchModalForm: React.FC<TicketBatchModalProps> = ({
  open,
  count,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<TicketBatchFormValues>
      title={`批量更新状态(${count} 条)`}
      open={open}
      // antd v6 里 destroyOnClose 已废弃,用 destroyOnHidden
      modalProps={{ destroyOnHidden: true }}
      onOpenChange={onOpenChange}
      onFinish={async (values) => {
        // 成功提示由请求层统一弹(后端信封里的 msg),这里返回 true/false 决定是否关闭弹窗
        return onSubmit(values.status);
      }}
    >
      <ProFormSelect
        name="status"
        label="目标状态"
        options={TICKET_STATUS_OPTIONS}
        rules={[{ required: true, message: '请选择目标状态' }]}
      />
    </ModalForm>
  );
};

export default TicketModalForm;
export { TicketBatchModalForm };
