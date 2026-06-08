/**
 * `@docket/ui/icons` — curated Material UI (`@mui/icons-material`) icon set.
 *
 * @remarks
 * Re-exports the handful of `@mui/icons-material` icons the app shell and ListView family
 * need, under stable, glyph-descriptive names, so feature code imports icons from one stable
 * subpath (`import { ChevronRight } from '@docket/ui/icons'`) rather than reaching into
 * `@mui/icons-material` directly. The export names are deliberately glyph-oriented (kept
 * stable across icon-library swaps) so changing the underlying icon library never touches
 * consumer code — only the mappings below change.
 *
 * Each name is aliased to the closest Material Symbols glyph (e.g. `ChevronDown` →
 * `KeyboardArrowDown`). Icons are sized the MUI way: they default to `1em` and honour
 * Tailwind width/height utility classes (`size-4`, `h-5 w-5`, …) supplied by consumers, so
 * existing sizing keeps working unchanged. Add new glyphs here as slices require them.
 */
import type SvgIcon from '@mui/material/SvgIcon';

export { default as Activity } from '@mui/icons-material/Timeline';
export { default as ArrowRight } from '@mui/icons-material/ArrowForward';
export { default as Building } from '@mui/icons-material/CorporateFare';
export { default as Cable } from '@mui/icons-material/Cable';
export { default as Calendar } from '@mui/icons-material/CalendarMonth';
export { default as Check } from '@mui/icons-material/Check';
export { default as CheckCircle2 } from '@mui/icons-material/CheckCircle';
export { default as ChevronDown } from '@mui/icons-material/KeyboardArrowDown';
export { default as ChevronLeft } from '@mui/icons-material/ChevronLeft';
export { default as ChevronRight } from '@mui/icons-material/ChevronRight';
export { default as ChevronUp } from '@mui/icons-material/KeyboardArrowUp';
export { default as Circle } from '@mui/icons-material/Circle';
export { default as CircleDashed } from '@mui/icons-material/RadioButtonUnchecked';
export { default as CircleDot } from '@mui/icons-material/RadioButtonChecked';
export { default as Command } from '@mui/icons-material/KeyboardCommandKey';
export { default as CornerDownLeft } from '@mui/icons-material/SubdirectoryArrowLeft';
export { default as CreditCard } from '@mui/icons-material/CreditCardOutlined';
export { default as Ellipsis } from '@mui/icons-material/MoreHoriz';
export { default as Filter } from '@mui/icons-material/FilterList';
export { default as Flag } from '@mui/icons-material/OutlinedFlag';
export { default as Folder } from '@mui/icons-material/FolderOpen';
export { default as FolderKanban } from '@mui/icons-material/ViewKanban';
export { default as GanttChart } from '@mui/icons-material/ViewTimeline';
export { default as Github } from '@mui/icons-material/GitHub';
export { default as Heart } from '@mui/icons-material/FavoriteBorder';
export { default as Globe } from '@mui/icons-material/Public';
export { default as ListChecks } from '@mui/icons-material/ChecklistRtl';
export { default as Home } from '@mui/icons-material/Home';
export { default as Inbox } from '@mui/icons-material/Inbox';
export { default as Layers } from '@mui/icons-material/Layers';
export { default as LayoutGrid } from '@mui/icons-material/GridView';
export { default as LogOut } from '@mui/icons-material/Logout';
export { default as Mail } from '@mui/icons-material/Mail';
export { default as Menu } from '@mui/icons-material/Menu';
export { default as MoreHorizontal } from '@mui/icons-material/MoreHoriz';
export { default as Plus } from '@mui/icons-material/Add';
export { default as RefreshCw } from '@mui/icons-material/Refresh';
export { default as Search } from '@mui/icons-material/Search';
export { default as Settings } from '@mui/icons-material/Settings';
export { default as Shield } from '@mui/icons-material/ShieldOutlined';
export { default as Sparkles } from '@mui/icons-material/AutoAwesome';
export { default as Tag } from '@mui/icons-material/LocalOfferOutlined';
export { default as Target } from '@mui/icons-material/TrackChanges';
export { default as TaskAlt } from '@mui/icons-material/TaskAlt';
export { default as Translate } from '@mui/icons-material/Translate';
export { default as Trash2 } from '@mui/icons-material/DeleteOutlined';
export { default as Users } from '@mui/icons-material/People';
export { default as User } from '@mui/icons-material/Person';
export { default as Workflow } from '@mui/icons-material/AccountTree';
export { default as X } from '@mui/icons-material/Close';
export { default as XCircle } from '@mui/icons-material/Cancel';

/**
 * The shared component type for every icon exported from this module.
 *
 * @remarks
 * Every `@mui/icons-material` glyph is a `SvgIcon` component (it accepts MUI's `SvgIconProps`,
 * including `className`, `fontSize`, and `sx`). The type name is kept as `LucideIcon` for
 * source-compatibility with consumers that annotate icon props (e.g. `icon: LucideIcon`),
 * even though the glyphs are now Material UI icons — renaming it would be a churny no-op.
 * `SvgIconComponent` is an internal (non-exported) alias inside `@mui/icons-material`, so the
 * type is derived here from the `@mui/material/SvgIcon` default export it points at.
 */
export type LucideIcon = typeof SvgIcon;
