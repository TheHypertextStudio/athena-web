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
export { default as Apple } from '@mui/icons-material/Apple';
export { default as ArrowRight } from '@mui/icons-material/ArrowForward';
/** The send affordance on a composer. Points up because the text travels up into the thread. */
export { default as ArrowUp } from '@mui/icons-material/ArrowUpward';
export { default as AtSign } from '@mui/icons-material/AlternateEmail';
export { default as Building } from '@mui/icons-material/CorporateFare';
export { default as Blueprint } from '@mui/icons-material/ArchitectureOutlined';
export { default as AlarmClock } from '@mui/icons-material/Alarm';
export { default as BarChart } from '@mui/icons-material/BarChartRounded';
export { default as Bell } from '@mui/icons-material/NotificationsNone';
export { default as BellOff } from '@mui/icons-material/NotificationsOff';
export { default as Cable } from '@mui/icons-material/Cable';
export { default as Calendar } from '@mui/icons-material/CalendarMonth';
export { default as CalendarToday } from '@mui/icons-material/Today';
export { default as Check } from '@mui/icons-material/Check';
export { default as CheckCircle2 } from '@mui/icons-material/CheckCircle';
export { default as ChevronDown } from '@mui/icons-material/KeyboardArrowDown';
export { default as ChevronLeft } from '@mui/icons-material/ChevronLeft';
export { default as ChevronRight } from '@mui/icons-material/ChevronRight';
export { default as ChevronUp } from '@mui/icons-material/KeyboardArrowUp';
export { default as Circle } from '@mui/icons-material/Circle';
export { default as CircleAlert } from '@mui/icons-material/ErrorOutlineOutlined';
export { default as CircleDashed } from '@mui/icons-material/RadioButtonUnchecked';
export { default as CircleDot } from '@mui/icons-material/RadioButtonChecked';
export { default as CloudOff } from '@mui/icons-material/CloudOff';
export { default as Code } from '@mui/icons-material/Code';
export { default as Copy } from '@mui/icons-material/ContentCopyOutlined';
export { default as Divider } from '@mui/icons-material/HorizontalRule';
export { default as FormatQuote } from '@mui/icons-material/FormatQuote';
export { default as Heading } from '@mui/icons-material/Title';
export { default as ListBulleted } from '@mui/icons-material/FormatListBulleted';
export { default as ListOrdered } from '@mui/icons-material/FormatListNumbered';
export { default as Command } from '@mui/icons-material/KeyboardCommandKey';
export { default as CornerDownLeft } from '@mui/icons-material/SubdirectoryArrowLeft';
export { default as CreditCard } from '@mui/icons-material/CreditCardOutlined';
export { default as Download } from '@mui/icons-material/FileDownloadOutlined';
export { default as Edit } from '@mui/icons-material/EditOutlined';
export { default as Ellipsis } from '@mui/icons-material/MoreHoriz';
export { default as ExpandMoreRounded } from '@mui/icons-material/ExpandMoreRounded';
export { default as Filter } from '@mui/icons-material/FilterList';
export { default as Flag } from '@mui/icons-material/OutlinedFlag';
export { default as FileGeneric } from '@mui/icons-material/InsertDriveFileOutlined';
export { default as FileImage } from '@mui/icons-material/ImageOutlined';
export { default as FilePdf } from '@mui/icons-material/PictureAsPdfOutlined';
export { default as FilePresentation } from '@mui/icons-material/SlideshowOutlined';
export { default as FileSpreadsheet } from '@mui/icons-material/TableChartOutlined';
export { default as FileText } from '@mui/icons-material/DescriptionOutlined';
export { default as FileVideo } from '@mui/icons-material/MovieOutlined';
export { default as Folder } from '@mui/icons-material/FolderOpen';
export { default as FolderKanban } from '@mui/icons-material/ViewKanban';
export { default as GanttChart } from '@mui/icons-material/ViewTimeline';
export { default as Github } from '@mui/icons-material/GitHub';
export { default as Google } from '@mui/icons-material/Google';
/** The grip on a reorderable row: two columns of dots, the universal "pick this up" mark. */
export { default as GripVertical } from '@mui/icons-material/DragIndicator';
export { default as Heart } from '@mui/icons-material/FavoriteBorder';
export { default as Library } from '@mui/icons-material/CollectionsBookmarkOutlined';
export { default as Globe } from '@mui/icons-material/Public';
export { default as HelpCircle } from '@mui/icons-material/HelpOutlined';
export { default as ListChecks } from '@mui/icons-material/ChecklistRtl';
export { default as ListView } from '@mui/icons-material/ViewList';
export { default as Home } from '@mui/icons-material/Home';
export { default as Inbox } from '@mui/icons-material/Inbox';
export { default as Layers } from '@mui/icons-material/Layers';
export { default as Link } from '@mui/icons-material/Link';
export { default as LayoutGrid } from '@mui/icons-material/GridView';
export { default as LayoutTemplate } from '@mui/icons-material/DashboardCustomizeOutlined';
export { default as LogOut } from '@mui/icons-material/Logout';
export { default as Mail } from '@mui/icons-material/Mail';
export { default as MapPin } from '@mui/icons-material/PlaceOutlined';
export { default as Maximize } from '@mui/icons-material/OpenInFull';
export { default as Menu } from '@mui/icons-material/Menu';
export { default as Minus } from '@mui/icons-material/Remove';
export { default as OpenBook } from '@mui/icons-material/MenuBookOutlined';
export { default as MessageSquare } from '@mui/icons-material/ChatOutlined';
export { default as MessagesSquare } from '@mui/icons-material/ForumOutlined';
export { default as MoreHorizontal } from '@mui/icons-material/MoreHoriz';
export { default as OpenInNew } from '@mui/icons-material/OpenInNew';
export { default as Paperclip } from '@mui/icons-material/AttachFile';
export { default as Pause } from '@mui/icons-material/Pause';
export { default as Play } from '@mui/icons-material/PlayArrow';
export { default as Plus } from '@mui/icons-material/Add';
export { default as RefreshCw } from '@mui/icons-material/Refresh';
export { default as Schedule } from '@mui/icons-material/Schedule';
export { default as ScheduleOutlined } from '@mui/icons-material/ScheduleOutlined';
export { default as Search } from '@mui/icons-material/Search';
export { default as SearchRounded } from '@mui/icons-material/SearchRounded';
export { default as SelfImprovement } from '@mui/icons-material/SelfImprovementOutlined';
export { default as Settings } from '@mui/icons-material/Settings';
export { default as Share } from '@mui/icons-material/IosShare';
export { default as Shield } from '@mui/icons-material/ShieldOutlined';
export { default as Mic } from '@mui/icons-material/MicNone';
export { default as MicOff } from '@mui/icons-material/MicOff';
export { default as Phone } from '@mui/icons-material/PhoneIphone';
export { default as PhoneOff } from '@mui/icons-material/PhoneDisabled';
export { default as SoundWave } from '@mui/icons-material/GraphicEq';
export { default as Sparkles } from '@mui/icons-material/AutoAwesome';
export { default as Stop } from '@mui/icons-material/StopRounded';
export { default as Tag } from '@mui/icons-material/LocalOfferRounded';
export { default as TuneRounded } from '@mui/icons-material/TuneRounded';
export { default as Target } from '@mui/icons-material/TrackChanges';
export { default as TaskAlt } from '@mui/icons-material/TaskAlt';
export { default as Timer } from '@mui/icons-material/TimerOutlined';
export { default as Translate } from '@mui/icons-material/Translate';
export { default as Trash2 } from '@mui/icons-material/DeleteOutlined';
export { default as Undo } from '@mui/icons-material/Undo';
export { default as Users } from '@mui/icons-material/People';
export { default as User } from '@mui/icons-material/Person';
export { default as UserOff } from '@mui/icons-material/PersonOffOutlined';
export { default as VideoCamera } from '@mui/icons-material/VideocamOutlined';
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

export {
  STRATEGIC_WORK_ROUNDED_ICON_BY_KEY,
  STRATEGIC_WORK_ROUNDED_ICON_OPTIONS,
  type StrategicWorkRoundedIconOption,
} from './strategic-work-rounded';
