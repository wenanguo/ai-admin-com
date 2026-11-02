/**
 * 这个文件作为组件的目录
 * 目的是统一管理对外输出的组件，方便分类
 */
/**
 * 布局组件
 */
import Footer from './Footer';
import { LangDropdown, VersionDropdown } from './RightContent';
import { AvatarDropdown } from './RightContent/AvatarDropdown';

/**
 * 业务组件
 */
export { default as ArticleListContent } from './ArticleListContent';
export { default as AvatarList } from './AvatarList';
export {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
  useDeleteHandler,
  useDeleteHandlerWithoutReload,
} from './CrudTable';
export { default as DeptTreeSelect } from './DeptTreeSelect';
export { default as ErrorBoundary } from './ErrorBoundary';
export { default as MenuPermissionTree } from './MenuPermissionTree';
export { default as OfflineBanner } from './OfflineBanner';
export { default as StandardFormRow } from './StandardFormRow';
export { default as TagSelect } from './TagSelect';

export { AvatarDropdown, Footer, LangDropdown, VersionDropdown };
