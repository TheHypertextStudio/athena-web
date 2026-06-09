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
  EmptyState,
  type EmptyStateCta,
  type EmptyStateProps,
  type EmptyStateTone,
} from './atoms/EmptyState';
export {
  STATE_TYPE_TOKEN_CLASS,
  StatusIcon,
  type StatusIconProps,
  type WorkflowStateType,
} from './atoms/StatusIcon';
export {
  EntityList,
  type EntityListProps,
  EntityListRow,
  type EntityListRowProps,
  type EntityRowRenderProps,
  RowMeta,
  type RowMetaProps,
  RowProgress,
  type RowProgressProps,
} from './views/EntityListRow';
export {
  ActorPicker,
  type ActorPickerProps,
  DatePicker,
  type DatePickerProps,
  type DateRange,
  DateRangePicker,
  type DateRangePickerProps,
  EntityPicker,
  type EntityPickerProps,
  EnumPicker,
  type EnumPickerProps,
  LabelsPicker,
  type LabelsPickerProps,
  OptionPicker,
  type OptionPickerProps,
  type PickerOption,
  PickerList,
  type PickerListProps,
  optionMatches,
  PropertyTrigger,
  type PropertyTriggerProps,
} from './pickers';
export {
  type Column,
  type ColumnPriority,
  EntityTable,
  type EntityTableGroup,
  type EntityTableProps,
  type EntityTableRowLinkProps,
} from './views/EntityTable';
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
  useContextState,
} from './shell/ContextProvider';
export {
  ShellDrawerProvider,
  type ShellDrawerDismiss,
  useShellDrawer,
} from './shell/ShellDrawerContext';
export { Sidebar, type SidebarProps } from './shell/Sidebar';
export { SidebarNavItem, type SidebarNavItemProps } from './shell/SidebarNavItem';
export { WorkspaceSwitcher, type WorkspaceSwitcherProps } from './shell/WorkspaceSwitcher';
export {
  type EntityWorkspaceNavKey,
  type HomeNavKey,
  type Workspace,
  type WorkspaceNavKey,
} from './shell/workspaces';
export {
  type OpenTab,
  TabBar,
  type TabBarProps,
  type TabDocType,
  type TabRenderLink,
} from './shell/TabBar';
