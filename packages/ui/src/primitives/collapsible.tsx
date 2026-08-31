/**
 * `@docket/ui` — Collapsible primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-collapsible`. A single disclosure: one trigger always visible, one region
 * that expands beneath it. Radix supplies full keyboard operability (Enter/Space to toggle) and
 * the `aria-expanded`/`data-state` wiring for free — this module adds nothing but the unstyled
 * passthrough roots, so every screen composes its own trigger/content look the way
 * {@link Popover} and {@link HoverCard} do.
 *
 * This is the primitive a dense disclosure row (a permission row, a collapsible section) reaches
 * for instead of native `<details>`/`<summary>`: same keyboard/AT contract, but the open state
 * reads from `data-[state=open]` like every other Radix primitive in this package, so a trigger's
 * chevron or a row's own styling composes with the rest of the system instead of the CSS `:open`
 * pseudo-class.
 *
 * @example
 * ```tsx
 * <Collapsible>
 *   <CollapsibleTrigger
 *     className={cn('group flex w-full items-center justify-between', focusRingInset)}
 *   >
 *     <span>Read your work</span>
 *     <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
 *   </CollapsibleTrigger>
 *   <CollapsibleContent>
 *     <p>View your tasks, projects, programs, initiatives, and cycles.</p>
 *   </CollapsibleContent>
 * </Collapsible>
 * ```
 */
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';

/** Root controller for an open/closed disclosure (Radix passthrough). */
export const Collapsible = CollapsiblePrimitive.Root;

/** Element that toggles the disclosure; renders a native `<button>` (Radix passthrough). */
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

/** The region that expands beneath the trigger when open (Radix passthrough). */
export const CollapsibleContent = CollapsiblePrimitive.Content;
