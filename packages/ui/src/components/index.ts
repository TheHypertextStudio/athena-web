/**
 * `@docket/ui/components` — barrel for the app shell components.
 *
 * @remarks
 * Re-exports the shell region components, the active-context provider, and the virtualized
 * ListView family so consumers can import them from a single subpath:
 * `import { AppShell, ListView } from '@docket/ui/components'`.
 */
export { AppBar, type AppBarProps } from './shell/AppBar';
export { ActorAvatar, type ActorAvatarProps, type ActorKind } from './atoms/ActorAvatar';
export { AuthLayout, type AuthLayoutProps } from './auth/AuthLayout';
export {
  EmptyState,
  type EmptyStateCta,
  type EmptyStateProps,
  type EmptyStateTone,
} from './atoms/EmptyState';
export {
  STATE_TYPE_TOKEN_CLASS,
  StatusGlyph,
  type StatusGlyphProps,
  StatusIcon,
  type StatusIconProps,
  type WorkflowStateType,
} from './atoms/StatusIcon';
export { IdentityGlyph, type IdentityGlyphProps } from './atoms/IdentityGlyph';
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
  addDays,
  addMonths,
  CALENDAR_MAX_DAY,
  CALENDAR_MIN_DAY,
  type CalendarCell,
  type CalendarDate,
  CalendarGrid,
  type CalendarGridProps,
  clampIso,
  compareIso,
  DAYS_PER_WEEK,
  daysInMonth,
  DatePicker,
  type DatePickerProps,
  type DateRange,
  DateRangePicker,
  type DateRangePickerProps,
  endOfMonth,
  formatCalendarDay,
  isIsoDate,
  localeWeekStart,
  monthGrid,
  monthLabel,
  parseIsoDate,
  startOfMonth,
  toCalendarDay,
  toIso,
  todayIso,
  weekdayLabels,
  weekdayOf,
  EntityPicker,
  type EntityPickerProps,
  EntityMultiPicker,
  type EntityMultiPickerProps,
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
export {
  AppShell,
  type AppShellProps,
  SHELL_DESKTOP_CHROME_PX,
  SHELL_DESKTOP_MIN_PX,
  SHELL_DESKTOP_QUERY,
  SHELL_MAIN_MIN_VIEWPORT_SHARE,
  shellMainInlineSize,
} from './shell/AppShell';
export {
  type AppShellAside,
  RAIL_INLINE_SIZE,
  RAIL_MAX_INLINE_SIZE_PX,
  RAIL_VIEWPORT_SHARE,
  type RailPanel,
  type RailPanelStatus,
} from './shell/ShellAside';
export {
  ContextProvider,
  type ContextProviderProps,
  type ContextState,
  type ActiveContext,
  type Density,
  DENSITIES,
  useContextState,
  useDensity,
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
