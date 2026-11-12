import { describe, expect, it } from 'vitest';
import type { ProjectOut } from '@/services/api/pm/project';
import {
  filterProjects,
  LIKE_FIELDS,
  SEARCHABLE_FIELDS,
} from './filterProjects';

function project(overrides: Partial<ProjectOut>): ProjectOut {
  return { id: 1, name: 'AIPM 核心项目', code: 'AIPM-CORE', ...overrides };
}

describe('filterProjects', () => {
  it('没有筛选条件 ⇒ 原样返回', () => {
    const projects = [project({}), project({ id: 2 })];
    expect(filterProjects(projects, {})).toHaveLength(2);
  });

  it('name 是「包含」不是「等于」', () => {
    const projects = [project({ id: 1 }), project({ id: 2, name: '订单中心' })];
    expect(filterProjects(projects, { name: '核心' }).map((p) => p.id)).toEqual(
      [1],
    );
  });

  it('name/code 的模糊匹配大小写不敏感（与 MySQL 的 LIKE 一致）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { name: 'aipm' })).toHaveLength(1);
    expect(filterProjects(projects, { name: 'AIPM' })).toHaveLength(1);
    expect(filterProjects(projects, { code: 'aipm-core' })).toHaveLength(1);
  });

  it('owner_id 是严格相等（数字用字符串比 ⇒ 表单给的 "7" 能匹配 7）', () => {
    const projects = [
      project({ id: 1, owner_id: 7 }),
      project({ id: 2, owner_id: 8 }),
    ];
    expect(
      filterProjects(projects, { owner_id: '7' }).map((p) => p.id),
    ).toEqual([1]);
  });

  it('空值条件不参与过滤（后端「参数为 None 就不加条件」）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { name: '' })).toHaveLength(1);
    expect(filterProjects(projects, { owner_id: undefined })).toHaveLength(1);
  });

  it('null 条件也不参与过滤（表单清空时给的就是 null）', () => {
    const projects = [project({ id: 1 }), project({ id: 2, name: '订单中心' })];
    expect(filterProjects(projects, { name: null })).toHaveLength(2);
  });

  it('status_code 是「包含」不是「等于」（它是下拉选，最容易搞错）', () => {
    const projects = [
      project({ id: 1, status_code: 'planning' }),
      project({ id: 2, status_code: 'planning_review' }),
      project({ id: 3, status_code: 'done' }),
    ];
    // 后端 status_code 走 QueueEnum.like ⇒ `planning` 也命中 `planning_review`
    expect(
      filterProjects(projects, { status_code: 'planning' }).map((p) => p.id),
    ).toEqual([1, 2]);
  });

  it('多个条件是「与」的关系（name + owner_id 同时给）', () => {
    const projects = [
      project({ id: 1, name: 'AIPM 核心项目', owner_id: 7 }),
      project({ id: 2, name: 'AIPM 核心项目', owner_id: 8 }),
      project({ id: 3, name: '订单中心', owner_id: 7 }),
    ];
    expect(
      filterProjects(projects, { name: 'AIPM', owner_id: 7 }).map((p) => p.id),
    ).toEqual([1]);
  });

  it('白名单之外的 key 不参与过滤（分页/版本号等塞进来的参数）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { __v: 123, current: 2 })).toHaveLength(1);
  });

  it('筛不出东西 ⇒ 空数组（不是保留全部）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { name: '不存在的项目' })).toEqual([]);
  });

  it('LIKE / 可搜索字段清单与后端一致', () => {
    expect([...LIKE_FIELDS].sort()).toEqual(
      [
        'code',
        'name',
        'priority_code',
        'status_code',
        'visibility_code',
      ].sort(),
    );
    expect([...SEARCHABLE_FIELDS].sort()).toEqual(
      ['code', 'name', 'owner_id', 'priority_code', 'status_code'].sort(),
    );
  });
});
