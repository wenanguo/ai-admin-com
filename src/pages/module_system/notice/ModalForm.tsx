import {
  ModalForm,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type React from 'react';
import { useMemo, useState } from 'react';
import type {
  NoticeCreateParams,
  NoticeOut,
} from '@/services/api/system/notice';

export type NoticeModalProps = {
  open: boolean;
  record?: NoticeOut;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: NoticeCreateParams) => Promise<boolean>;
};

/**
 * 公告类型的默认候选项。
 *
 * 后端 notice_type 是**普通字符串,没有枚举** —— 所以这里只给几个常见值,
 * 不写死成受限枚举:管理员可以在下拉框里直接输入自己的值。
 *
 * ⚠️ label 是给管理员看的文案,value 是**提交给后端的值**(这里两者一致)。
 *    若后端把 notice_type 收紧成代码(如 '1'/'2'),只改这一处即可。
 */
const NOTICE_TYPE_OPTIONS = [
  { label: '通知', value: '通知' },
  { label: '公告', value: '公告' },
  { label: '提醒', value: '提醒' },
];

const NoticeModalForm: React.FC<NoticeModalProps> = ({
  open,
  record,
  onOpenChange,
  onSubmit,
}) => {
  /** 管理员输入的自定义类型(只保留最近一次输入) */
  const [customType, setCustomType] = useState<string | undefined>(undefined);

  const recordType = record?.notice_type ?? undefined;

  /**
   * 下拉候选项 = 默认值 + 记录里已有的类型 + 刚输入的自定义类型。
   *
   * 记录里已有的类型要带上:老数据的类型可能不在默认候选里,
   * 编辑时如果候选项里没有它,下拉框会显示成空白。
   */
  const typeOptions = useMemo(() => {
    const values = NOTICE_TYPE_OPTIONS.map((option) => option.value);
    for (const value of [recordType, customType]) {
      if (value && !values.includes(value)) values.push(value);
    }
    return values.map((value) => ({ label: value, value }));
  }, [customType, recordType]);

  /**
   * 输入的词不在候选项里时,把它加成候选项 —— 管理员就能选自己的值。
   *
   * 只保留最近一次输入:逐字输入的过程中('自' → '自定义')候选项会被替换,
   * 而不是堆积成一串半截词。
   */
  const handleTypeSearch = (text: string) => {
    setCustomType(text.trim() || undefined);
  };

  return (
    <ModalForm<NoticeCreateParams>
      title={record?.id ? '编辑公告' : '新增公告'}
      open={open}
      initialValues={{
        notice_title: record?.notice_title ?? undefined,
        notice_type: record?.notice_type ?? undefined,
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
        options={typeOptions}
        fieldProps={{
          showSearch: true,
          allowClear: true,
          onSearch: handleTypeSearch,
        }}
        rules={[{ required: true, message: '请选择或输入公告类型' }]}
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
