/**
 * `@docket/ui/primitives` — barrel for the shadcn "new-york" primitives.
 *
 * @remarks
 * Re-exports every hand-authored primitive (button, input, card, badge, avatar,
 * skeleton, dropdown-menu, dialog, separator) so consumers can import from a single subpath:
 * `import { Button, Card } from '@docket/ui/primitives'`.
 */
export { Avatar, AvatarFallback, AvatarImage } from './avatar';
export { Badge, badgeVariants, type BadgeProps } from './badge';
export { Button, buttonVariants, type ButtonProps } from './button';
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
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
export { Input, type InputProps } from './input';
export { Separator } from './separator';
export { Skeleton } from './skeleton';
