import {
  ModalForm,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import type {
  NoticeCreateParams,
  NoticeOut,
  NoticeType,
} from '@/services/api/system/notice';

export type NoticeModalProps = {
  open: boolean;
  record?: NoticeOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: NoticeCreateParams) => Promise<boolean>;
};

/**
 * 公告类型的候选项。
 *
 * ⚠️ value 是**提交给后端的值**,label 只是给管理员看的文案 —— 两者**不相同**:
 *    后端只认单字符代码 '1'(通知)/ '2'(公告)
 *    (`NoticeCreateSchema.notice_type` 是 max_length=1,且校验器
 *    `_validate_notice_type` 只接受 {'1','2'})。
 *
 * 所以这里**不能**做成「可输入自定义值」的下拉:后端会把任何其它值判成 422,
 * 让管理员填一个必然失败的值没有意义。
 */
const NOTICE_TYPE_OPTIONS: { label: string; value: NoticeType }[] = [
  { label: '通知', value: '1' },
  { label: '公告', value: '2' },
];

/**
 * 把后端返回的 notice_type 收窄成 NoticeType。
 *
 * 后端的响应模型继承同一个校验器,正常只可能是 '1' / '2';
 * 万一遇到别的值,宁可当成「没填」,也不要把它原样塞进表单 ——
 * 表单提交的是 NoticeType,塞一个非法字符串过去必然 422。
 */
function toNoticeType(
  value: string | null | undefined,
): NoticeType | undefined {
  return value === '1' || value === '2' ? value : undefined;
}

const NoticeModalForm: React.FC<NoticeModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  return (
    <ModalForm<NoticeCreateParams>
      title={record?.id ? '编辑公告' : '新增公告'}
      open={open}
      initialValues={{
        notice_title: record?.notice_title ?? undefined,
        notice_type: toNoticeType(record?.notice_type),
        notice_content: record?.notice_content ?? undefined,
        status: record?.status ?? 0,
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
        name="notice_title"
        label="公告标题"
        rules={[{ required: true, message: '请输入公告标题' }]}
      />
      <ProFormSelect
        name="notice_type"
        label="公告类型"
        options={NOTICE_TYPE_OPTIONS}
        fieldProps={{ allowClear: true }}
        rules={[{ required: true, message: '请选择公告类型' }]}
      />
      <ProFormTextArea
        name="notice_content"
        label="公告内容"
        fieldProps={{ rows: 4 }}
      />
      <ProFormSelect
        name="status"
        label="状态"
        options={[
          { label: '正常', value: 0 },
          { label: '禁用', value: 1 },
        ]}
      />
      <ProFormTextArea
        name="description"
        label="描述"
        fieldProps={{ rows: 3 }}
      />
    </ModalForm>
  );
};

export default NoticeModalForm;
