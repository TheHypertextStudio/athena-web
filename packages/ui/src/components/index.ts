/**
 * `@docket/ui/components` — barrel for the app shell components.
 *
 * @remarks
 * Re-exports the shell region components, the active-context provider, and the virtualized
 * ListView family so consumers can import them from a single subpath:
 * `import { AppShell, ListView } from '@docket/ui/components'`.
 */
export { ActorAvatar, type ActorAvatarProps, type ActorKind } from './atoms/ActorAvatar';
export {
  STATE_TYPE_TOKEN_CLASS,
  StatusIcon,
  type StatusIconProps,
  type WorkflowStateType,
} from './atoms/StatusIcon';
export { GroupHeader, type GroupHeaderProps } from './views/GroupHeader';
export { ListGroup, type ListGroupProps } from './views/ListGroup';
export {
  type FlatRow,
  type GroupKey,
  ListView,
  type ListViewProps,
  NO_GROUP_ID,
  NO_GROUP_LABEL,
  type RenderRowContext,
} from './views/ListView';
export {
  ListCell,
  type ListCellProps,
  ListRow,
  type ListRowProps,
  TaskRow,
  type TaskRowData,
  type TaskRowProps,
} from './views/ListRow';
export { ListSubGroup, type ListSubGroupProps } from './views/ListSubGroup';
export { AppShell, type AppShellProps } from './shell/AppShell';
export {
  ContextProvider,
  type ContextProviderProps,
  type ContextState,
  type ActiveContext,
  type Density,
  HUB_CONTEXT,
  useContextState,
} from './shell/ContextProvider';
export {
  ContextSidebar,
  type ContextSidebarProps,
  type SidebarNavKey,
} from './shell/ContextSidebar';
export {
  AddOrgButton,
  type AddOrgButtonProps,
  GlobalRail,
  type GlobalRailProps,
  type RailOrg,
} from './shell/GlobalRail';
export { RailOrgAvatar, type RailOrgAvatarProps } from './shell/RailOrgAvatar';
export { SidebarNavItem, type SidebarNavItemProps } from './shell/SidebarNavItem';
