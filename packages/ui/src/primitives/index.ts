/**
 * `@docket/ui/primitives` — barrel for the shadcn "new-york" primitives.
 *
 * @remarks
 * Re-exports every hand-authored primitive (button, input, card, badge, avatar,
 * skeleton, dropdown-menu, context-menu, dialog, sheet, separator, popover, tooltip,
 * hover-card) plus the shared focus-ring convention so consumers can import from a single
 * subpath: `import { Button, Card, focusRing } from '@docket/ui/primitives'`.
 */
export { Avatar, AvatarFallback, AvatarImage } from './avatar';
export { Badge, badgeVariants, type BadgeProps } from './badge';
export { Button, buttonVariants, type ButtonProps } from './button';
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
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
export { focusRing, focusRingInset } from './focus';
export { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';
export { Input, type InputProps } from './input';
export { Row, type RowProps, Stack, type StackProps } from './layout';
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
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
