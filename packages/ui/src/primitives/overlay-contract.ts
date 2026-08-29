/** Shared, closed geometry contracts for Docket's modal and panel presentations. */

/** Horizontal inset shared by an overlay's header, body, and footer. */
export type OverlayInset = 'none' | 'compact' | 'standard';

/** Width tiers for centered dialogs. */
export type DialogSize = 'compact' | 'standard' | 'large' | 'wide' | 'detail' | 'workspace';

/** Height tiers for dialogs that cannot be content-sized. */
export type DialogHeight = 'content' | 'medium' | 'tall' | 'viewport';

/** An explicit local host rectangle for an in-shell dialog. */
export interface HostedDialogPosition {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
}

/** One visual presentation for a Dialog. */
export type DialogPresentation =
  | {
      readonly kind: 'centered' | 'top' | 'responsive-fullscreen' | 'fullscreen' | 'bottom-sheet';
      readonly size?: DialogSize;
      readonly height?: DialogHeight;
    }
  | {
      readonly kind: 'hosted';
      readonly size?: DialogSize;
      readonly height?: DialogHeight;
      readonly portalContainer: HTMLElement;
      readonly position: HostedDialogPosition;
      readonly backdrop?: 'none' | 'surface';
    };

/** Sheet geometry selected by the owning shell or route. */
export type SheetPresentation = 'edge' | 'fullscreen' | 'responsive-fullscreen';

/** Width tiers for a Sheet. */
export type SheetSize = 'navigation' | 'standard' | 'wide';

/** Semantic treatment for a Popover container. */
export type PopoverPresentation = 'menu' | 'panel';

/** Fixed width tiers for a non-menu Popover panel. */
export type PanelWidth = 'sm' | 'md' | 'lg' | 'xl' | 'wide' | 'content';
