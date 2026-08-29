'use client';

/**
 * `components/context-menu/object-context-menu` — the app's one right-click handler.
 *
 * @remarks
 * Exactly one `contextmenu` listener exists in Docket, and it is here. It does not know what a
 * task is, what a calendar block is, or which surfaces exist. It walks up from whatever was
 * right-clicked until it finds an element wearing `objectTargetProps`, asks the action registry
 * what can be done to that object, and renders the answer at the pointer.
 *
 * That indirection is the entire design. Per-surface menus are how apps end up with a rename item
 * on the project row and not on the project header, or a delete that skips confirmation in one
 * place. Here a surface contributes an object and an action scope, a domain contributes actions,
 * and the registry derives the menu. Ordinary object surfaces get their complete applicable
 * action set. Read-only reference surfaces get only exact Open and Copy actions for their object
 * kind. A new action still appears everywhere its scope allows without changing each surface.
 *
 * ## What it deliberately does not take over
 *
 * Right-clicking a text input, a textarea, or the rich-text editor leaves the browser's own menu
 * alone. Spellcheck suggestions, paste, "look up", and the whole native text affordance are worth
 * more than a menu of app actions in a place where the user is manipulating text. An element (or
 * subtree) can also opt out explicitly with `data-native-context-menu="true"`. And when an object
 * *is* found but has no applicable actions, the native menu is left alone too, rather than opening
 * an empty panel that reads as broken.
 *
 * ## Selection awareness
 *
 * Right-clicking one of several selected rows acts on the whole selection. The handler reads it
 * from {@link ../selection/selection-registry}. The narrower scope between the host and selection
 * surface controls which actions the registry may resolve for that selection.
 *
 * ## Keyboard
 *
 * Shift+F10 and the Menu key raise a `contextmenu` event just like a right-click, so the menu is
 * keyboard-reachable for free. Those events carry no useful pointer coordinates, so the menu is
 * anchored to the focused object's own box instead. Radix supplies arrow-key roving, typeahead,
 * and Escape-to-close; focus is returned to the element the menu was opened from.
 */
import { cn } from '@docket/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  describeObject,
  OBJECT_TARGET_SELECTOR,
  type ObjectActionScope,
  type ObjectRef,
  objectKey,
  readObjectActionScope,
  readObjectTarget,
} from '@/lib/actions/object';
import { useActionRegistry } from '@/lib/actions/registry-context';
import { useResolvedActions } from '@/lib/actions/registry-context';
import type { ActionContext, ResolvedAction } from '@/lib/actions/types';
import { readSelectionSurfaceFor } from '@/components/selection/selection-registry';

/** Elements whose native context menu is always preserved. */
const NATIVE_MENU_SELECTOR =
  '[data-native-context-menu="true"], input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Object subjects and scope derived from one marked DOM host. */
interface ObjectMenuSubject {
  /** Stable identity of the marked host, even when that host belongs to a multi-selection. */
  readonly hostObjectIdentity: string;
  /** The objects the menu acts on — one, or the whole selection it belongs to. */
  readonly objects: readonly ObjectRef[];
  /** The workspace the invocation happened in. */
  readonly organizationId: string | null;
  /** The surface the object belongs to, when it belongs to one. */
  readonly surfaceId: string | undefined;
  /** The actions this particular object surface may expose. */
  readonly actionScope: ObjectActionScope;
}

/** An open menu's anchor and resolved subject. */
interface OpenMenu extends ObjectMenuSubject {
  /** Viewport x to anchor at. */
  readonly x: number;
  /** Viewport y to anchor at. */
  readonly y: number;
  /** The element focus returns to when the menu closes. */
  readonly origin: HTMLElement | null;
  /** The marked object host that remains the invocation-time authority. */
  readonly host: HTMLElement;
}

/** Include ownership because the same record id must never authorize a different workspace. */
function objectMenuIdentity(object: ObjectRef): string {
  return `${objectKey(object)}\u0000${object.organizationId ?? ''}`;
}

/** Whether a live host still names the exact subject shown when the menu opened. */
function sameMenuSubject(left: ObjectMenuSubject, right: ObjectMenuSubject): boolean {
  if (
    left.hostObjectIdentity !== right.hostObjectIdentity ||
    left.organizationId !== right.organizationId ||
    left.surfaceId !== right.surfaceId ||
    left.objects.length !== right.objects.length
  )
    return false;
  const leftObjects = left.objects.map(objectMenuIdentity).sort();
  const rightObjects = right.objects.map(objectMenuIdentity).sort();
  return leftObjects.every((identity, index) => identity === rightObjects[index]);
}

/** Fail closed when an open menu no longer has the DOM subject that produced it. */
function emptyReferenceContext(): ActionContext {
  return {
    objects: [],
    source: 'context-menu',
    organizationId: null,
    actionScope: 'reference',
  };
}

/** Resolve selection and action scope from the same marked object host. */
function subjectForObjectHost(host: HTMLElement): ObjectMenuSubject | null {
  const object = readObjectTarget(host);
  if (object === null) return null;
  const hostActionScope = readObjectActionScope(host);
  const surface = readSelectionSurfaceFor(host);
  const inSelection =
    surface?.selectedObjects.some((selected) => objectKey(selected) === objectKey(object)) ?? false;
  const actionScope =
    hostActionScope === 'reference' || surface?.actionScope === 'reference' ? 'reference' : 'all';
  return {
    hostObjectIdentity: objectMenuIdentity(object),
    objects: inSelection && surface !== null ? surface.selectedObjects : [object],
    organizationId: object.organizationId ?? surface?.organizationId ?? null,
    surfaceId: surface?.surfaceId,
    actionScope,
  };
}

/** Build the registry context shared by pointer and explicit menu invocation. */
function contextForSubject(subject: ObjectMenuSubject): ActionContext {
  return {
    objects: subject.objects,
    source: 'context-menu',
    organizationId: subject.organizationId,
    actionScope: subject.actionScope,
    ...(subject.surfaceId === undefined ? {} : { surfaceId: subject.surfaceId }),
  };
}

/** Re-read an open menu's object and scope so a stale item cannot invoke a newly-forbidden write. */
function contextForOpenMenu(menu: OpenMenu): ActionContext {
  if (!menu.host.isConnected) return emptyReferenceContext();
  const subject = subjectForObjectHost(menu.host);
  return subject === null || !sameMenuSubject(menu, subject)
    ? emptyReferenceContext()
    : contextForSubject(subject);
}

/** What {@link useObjectContextMenu} exposes. */
export interface ObjectContextMenuControls {
  /** Whether a menu is currently open. */
  readonly isOpen: boolean;
  /**
   * Open the object menu explicitly, for surfaces with their own "more actions" affordance.
   *
   * @remarks
   * Using this rather than building a second menu is what keeps the overflow button and the
   * right-click menu permanently identical.
   */
  readonly openFor: (anchor: HTMLElement) => void;
  /** Close whatever is open. */
  readonly close: () => void;
}

const ObjectContextMenuContext = createContext<ObjectContextMenuControls | null>(null);

/** Props for {@link ObjectContextMenuProvider}. */
export interface ObjectContextMenuProviderProps {
  /** The app subtree served by this handler. Mount exactly one, at the root. */
  readonly children: ReactNode;
}

/**
 * Install the app's single object context menu.
 *
 * @param props - The app subtree.
 * @returns The provider element plus the menu surface.
 */
export function ObjectContextMenuProvider({
  children,
}: ObjectContextMenuProviderProps): JSX.Element {
  const registry = useActionRegistry();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // Read inside the listener without making the listener depend on React state.
  const registryRef = useRef(registry);
  registryRef.current = registry;

  const close = useCallback(() => {
    setMenu(null);
  }, []);

  const openFor = useCallback((anchor: HTMLElement) => {
    const host = anchor.closest<HTMLElement>(OBJECT_TARGET_SELECTOR);
    if (host === null) return;
    const subject = subjectForObjectHost(host);
    if (subject === null) return;
    const context = contextForSubject(subject);
    if (registryRef.current.resolve(() => context).length === 0) return;
    const rect = anchor.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom,
      ...subject,
      origin: anchor,
      host,
    });
  }, []);

  useEffect(() => {
    function onContextMenu(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null) return;
      // Text editing keeps the platform's own menu — spellcheck and paste beat app actions there.
      if (target.closest(NATIVE_MENU_SELECTOR) !== null) return;

      const host = target.closest(OBJECT_TARGET_SELECTOR);
      if (!(host instanceof HTMLElement)) return;
      const subject = subjectForObjectHost(host);
      if (subject === null) return;
      const context = contextForSubject(subject);
      // An empty menu is worse than the browser's, so the app only claims the event when it has
      // something to offer.
      if (registryRef.current.resolve(() => context).length === 0) return;

      event.preventDefault();
      // Keyboard invocation (Shift+F10 / the Menu key) reports no useful coordinates, so the menu
      // is anchored to the focused object's own box instead of to (0, 0).
      const keyboardInvoked = event.clientX === 0 && event.clientY === 0;
      const rect = host.getBoundingClientRect();
      setMenu({
        x: keyboardInvoked ? rect.left : event.clientX,
        y: keyboardInvoked ? rect.bottom : event.clientY,
        ...subject,
        origin: host,
        host,
      });
    }

    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  const controls = useMemo<ObjectContextMenuControls>(
    () => ({ isOpen: menu !== null, openFor, close }),
    [menu, openFor, close],
  );

  return (
    <ObjectContextMenuContext.Provider value={controls}>
      {children}
      {menu === null ? null : <ObjectContextMenuSurface menu={menu} onClose={close} />}
    </ObjectContextMenuContext.Provider>
  );
}

/**
 * Control the object context menu from a surface's own affordance.
 *
 * @returns The menu controls, or `null` outside the provider.
 */
export function useObjectContextMenu(): ObjectContextMenuControls | null {
  return useContext(ObjectContextMenuContext);
}

/** Props for the rendered menu. */
interface ObjectContextMenuSurfaceProps {
  readonly menu: OpenMenu;
  readonly onClose: () => void;
}

/**
 * The menu itself, rendered at the pointer.
 *
 * @remarks
 * A zero-size fixed-position element stands in as the Radix trigger, which is how a menu built for
 * a *button* is anchored to a *point*. Radix then supplies `role="menu"`, roving arrow-key focus,
 * typeahead, and Escape-to-close; `onCloseAutoFocus` is intercepted so focus returns to the object
 * that was right-clicked rather than to the invisible stand-in.
 */
function ObjectContextMenuSurface({ menu, onClose }: ObjectContextMenuSurfaceProps): JSX.Element {
  const resolveContext = useCallback((): ActionContext => contextForOpenMenu(menu), [menu]);
  const actions = useResolvedActions(resolveContext);
  const heading = describeMenuSubject(menu.objects);

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        width="md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          menu.origin?.focus();
        }}
      >
        <DropdownMenuLabel>{heading}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {renderSections(actions, onClose)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Name what the menu acts on: the object's title, or how many objects there are. */
function describeMenuSubject(objects: readonly ObjectRef[]): string {
  const first = objects[0];
  if (first === undefined) return '';
  if (objects.length === 1) return first.title;
  const descriptor = describeObject(first.kind);
  const sameKind = objects.every((object) => object.kind === first.kind);
  const noun = sameKind ? descriptor.pluralNoun.toLowerCase() : 'items';
  return `${objects.length} ${noun} selected`;
}

/** Render the resolved actions, separating each section from the last. */
function renderSections(actions: readonly ResolvedAction[], onClose: () => void): ReactNode {
  const rows: ReactNode[] = [];
  let previousSection: string | null = null;
  for (const action of actions) {
    if (previousSection !== null && action.section !== previousSection) {
      rows.push(<DropdownMenuSeparator key={`sep-${action.id}`} />);
    }
    previousSection = action.section;
    const Icon = action.icon;
    rows.push(
      <DropdownMenuItem
        key={action.id}
        disabled={action.disabledReason !== null}
        {...(action.disabledReason === null ? {} : { supporting: action.disabledReason })}
        className={cn(action.destructive && 'text-error focus:text-error')}
        onSelect={() => {
          onClose();
          // Let Radix finish its close and focus-restoration cycle before an action opens a
          // second overlay. Invoking in the same select event makes that restored focus count as
          // an outside interaction, so picker actions appear to flash closed immediately.
          window.setTimeout(() => {
            void action.invoke();
          }, 0);
        }}
      >
        <Icon className="h-4 w-4" />
        {action.label}
        {action.shortcutHint === null ? null : (
          <DropdownMenuShortcut>{action.shortcutHint}</DropdownMenuShortcut>
        )}
      </DropdownMenuItem>,
    );
  }
  return rows;
}
