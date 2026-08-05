/**
 * `@docket/ui/primitives` — barrel for the shadcn "new-york" primitives.
 *
 * @remarks
 * Re-exports every hand-authored primitive plus the three modules that define the system's
 * closed vocabularies — `control` (the height scale), `text` (the MD3 type scale), and `field`
 * (the input family) — so consumers import from a single subpath:
 * `import { Button, Chip, ControlGroup, Text } from '@docket/ui/primitives'`.
 *
 * The design contract every screen builds against is written up in `docs/design/design-system.md`;
 * `packages/test-utils/tests/design-policies/design-token-policy.test.ts` enforces it in CI.
 */
export { Avatar, AvatarFallback, AvatarImage } from './avatar';
export {
  Badge,
  BADGE_VARIANTS,
  type BadgeProps,
  type BadgeVariant,
  badgeVariants,
  type BadgeVariantsOptions,
} from './badge';
export {
  BUTTON_VARIANTS,
  Button,
  type ButtonProps,
  type ButtonVariant,
  buttonVariants,
  type ButtonVariantsOptions,
  type LegacyButtonSize,
} from './button';
export {
  CHIP_TONES,
  CHIP_VARIANTS,
  Chip,
  type ChipLeadingExemption,
  type ChipProps,
  type ChipTone,
  type ChipVariant,
} from './chip';
export {
  CONTAINER_RADIUS,
  CONTROL,
  CONTROL_RADIUS,
  CONTROL_SIZES,
  ControlGroup,
  type ControlGroupProps,
  type ControlMetrics,
  type ControlSize,
  controlChrome,
  DEFAULT_CONTROL_SIZE,
  useControlMetrics,
  useControlSize,
} from './control';
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
export { Checkbox, type CheckboxProps } from './checkbox';
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu';
export { DecorativeIcon, type DecorativeIconProps } from './decorative-icon';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './dialog';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';
export {
  Field,
  FIELD_VARIANTS,
  type FieldProps,
  type FieldSurfaceOptions,
  type FieldVariant,
  fieldSurface,
  Input,
  type InputProps,
  Select,
  type SelectProps,
  Textarea,
  type TextareaProps,
} from './field';
export { focusRing, focusRingInset } from './focus';

/*
 * The MD3 menu style source. Exported because "one menu" has to mean one across the product: the
 * command palette, the mention menu, and the editor's suggestion menu are all menus, and they live
 * in `apps/web`.
 *
 * A surface that renders a list of choices on a temporary surface uses these builders rather than
 * writing its own `min-h-*`/`rounded-*`/`px-*` set, which `design-token-scan.ts` enforces.
 */
export {
  DEFAULT_MENU_SECTIONS,
  MENU_INDICATOR_GUTTER,
  MENU_METRICS,
  type MenuItemClassOptions,
  type MenuSections,
  type MenuVariant,
  menuBadge,
  menuCheckedItemClass,
  menuContentClass,
  menuFocusRing,
  menuGroup,
  menuItemClass,
  menuLabel,
  menuSeparator,
  menuSupporting,
  menuTrailingText,
} from './menu-styles';

export { OVERLAY_COLLISION_PADDING } from './overlay-inset';
export { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';
export { Row, type RowProps, Stack, type StackProps, Toolbar, type ToolbarProps } from './layout';
export {
  Popover,
  PopoverAnchor,
  type PopoverAnchorProps,
  PopoverContent,
  PopoverTrigger,
  type PopoverVirtualAnchor,
  type PopoverVirtualAnchorRef,
} from './popover';
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetOverlay,
  SheetPortal,
  type SheetSide,
  SheetTitle,
  SheetTrigger,
} from './sheet';
export { Separator } from './separator';
export { Skeleton } from './skeleton';
export {
  Tab,
  TabList,
  type TabListProps,
  type TabProps,
  Tabs,
  type TabsItem,
  type TabsProps,
} from './tabs';
export {
  Text,
  TEXT_TONES,
  type TextProps,
  type TextTone,
  TYPE_TOKENS,
  type TypeToken,
  toneClass,
  typeClass,
} from './text';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
