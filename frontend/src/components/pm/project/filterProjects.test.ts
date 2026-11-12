import { describe, expect, it } from 'vitest';
import type { ProjectOut } from '@/services/api/pm/project';
import { filterProjects } from './filterProjects';

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

  it('白名单之外的 key 不参与过滤（分页/版本号等塞进来的参数）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { __v: 123, current: 2 })).toHaveLength(1);
  });

  it('筛不出东西 ⇒ 空数组（不是保留全部）', () => {
    const projects = [project({ id: 1 })];
    expect(filterProjects(projects, { name: '不存在的项目' })).toEqual([]);
  });
});
