# Overlay migration inventory

This inventory is for Athena UI maintainers. Use the named primitive presentation and slot that
each row records. Do not replace the listed geometry with a new local class string.

The 2026-08-29 scan found these direct shared-content overrides. The first two rows are shared
picker implementations. The rest are product or shell consumers. The migration closes only when
the direct-content search returns no results.

| File | Current role | Required shared owner | Status |
| --- | --- | --- | --- |
| `packages/ui/src/components/pickers/DatePicker.tsx` | Date picker panel | `PopoverContent presentation="panel" width="content"` and `PopoverBody` | Migrated |
| `packages/ui/src/components/pickers/TimeframePicker.tsx` | Timeframe picker panel | `PopoverContent presentation="panel" width="xl"` and `PopoverBody` | Migrated |
| `packages/ui/src/components/shell/tab-overflow-menu.tsx` | Searchable open-document panel | `PopoverContent presentation="panel" width="wide"`, header, and one body | Migrated |
| `packages/ui/src/components/shell/AppShell.tsx` | Mobile navigation and utility sheets | Typed `SheetContent` presentations; utility sheet has one `SheetBody` | Migrated |
| `apps/web/src/components/canvas/bulk-actions-bar.tsx` | Selected-object editor | Centered tall `DialogContent`, `DialogHeader`, and `DialogBody` | Migrated |
| `apps/web/src/app/(app)/calendar/calendar-shared-item-details.tsx` | Read-only calendar details | Centered tall `DialogContent`, `DialogHeader`, and `DialogBody` | Migrated |
| `apps/web/src/app/(app)/calendar/calendar-layers-menu.tsx` | Calendar visibility panel | `PopoverContent presentation="panel" width="xl"` and `PopoverBody` | Migrated |
| `apps/web/src/components/calendar/calendar-timezone-dialog.tsx` | Time-zone picker | Centered compact `DialogContent` with one `DialogBody` and fixed footer | Migrated |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx` | Calendar item editor | Centered detail/tall `DialogContent`; workspace provides one body owner | Migrated |
| `apps/web/src/components/scheduling/scheduling-dense-overflow-ui.tsx` | Dense event list | `PopoverContent presentation="panel" width="lg"`, header, and one body | Migrated |

The semantic scan also found the following. Primitive implementations own their Radix roles and
scrims. The marketing paper layer is noninteractive. The remaining app-owned semantic surfaces
must migrate before the ownership lint rule reaches error severity.

| Match | Classification | Status |
| --- | --- | --- |
| `packages/ui/src/primitives/dialog.tsx` and `sheet.tsx` dialog roles and fixed scrims | Shared primitive infrastructure | Allowed |
| `apps/web/src/app/(marketing)/layout.tsx` paper layer | Noninteractive page backdrop | Allowed |
| `apps/web/src/components/athena/mcp-app-view.tsx` fixed fullscreen shell | App-owned modal shell | Pending |
| `apps/web/src/components/work-views/filter-builder.tsx` and `display-controls.tsx` dialog roles | Shared panel semantics still declared by consumers | Pending review |
| `packages/ui/src/components/shell/tab-overflow-menu.tsx` and `apps/web/src/components/scheduling/scheduling-dense-overflow-ui.tsx` dialog roles | Popover semantics supplied by consumer | Migrated |

No direct Radix overlay imports outside `packages/ui/src/primitives/` appeared in this scan. The
remaining `menu-styles` imports belong to primitive or shared menu implementations.
