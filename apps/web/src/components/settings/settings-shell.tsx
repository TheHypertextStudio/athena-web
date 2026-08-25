'use client';

/**
 * `settings` — the settings modal shell (Notion / Claude-Desktop style, not a Linear-style page).
 *
 * @remarks
 * Wraps `{children}` — the app's ordinary `(app)` route content — exactly the way
 * `CommandPaletteProvider` already does in `app-shell-frame.tsx`. When `active` is `false` it is a
 * pure pass-through: `children` renders as the normal page. When `active` is `true` (the pathname
 * matches a settings route — the same `settingsSurface` boolean the shell already computed to
 * suppress the context aside), it renders `children` inside a large modal instead: real,
 * deep-linkable, refreshable settings URLs, presented as a floating "Preferences" panel rather
 * than a page navigation. No new routing mechanism, no client-side settings state — the URL is
 * still the single source of truth for which section is open; this only changes how that URL's
 * content is framed.
 *
 * Closing (Escape, the scrim, or the close button) returns to the last non-settings pathname the
 * viewer was on, tracked in a ref while `active` is `false` — a direct link straight into settings
 * falls back to `/today`. Switching the workspace-switcher chip is a real navigation to that
 * workspace's settings default section; because this component sits outside `children`, the modal
 * itself never unmounts across that navigation, so it stays visually open and in place.
 */
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  SettingsDialogContent,
  Surface,
} from '@docket/ui/primitives';
import { type Workspace, WorkspaceSwitcher } from '@docket/ui/components';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useAppPathname } from '@/lib/app-location';
import { CREATE_WORKSPACE_PATH } from '@/lib/workspace-creation';
import {
  focusPendingRouteFragment,
  hasPendingRouteFragmentFocus,
} from '@/lib/interactions/route-fragment-focus';

import {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  DEFAULT_WORKSPACE_SETTINGS_SECTION,
  personalSectionHref,
  sectionHref,
} from './settings-registry';
import { focusSettingsHashTarget } from './settings-focus';
import { SettingsPane } from './settings-pane';
import { SettingsShellNav, useSettingsShellWorkspace } from './settings-shell-nav';

/** The pathname to fall back to when settings was opened with no prior page (a direct link). */
const DEFAULT_CLOSE_TARGET = '/today';
const FRAGMENT_FOCUS_RETRY_MS = 25;
const MAX_FRAGMENT_FOCUS_ATTEMPTS = 80;
const REQUIRED_STABLE_FRAGMENT_FOCUSES = 8;

function stabilizeSettingsFragmentFocus(): void {
  let attempts = 0;
  const focusFragment = (): void => {
    if (!focusSettingsHashTarget()) {
      focusPendingRouteFragment();
    }
    attempts += 1;
    if (attempts < REQUIRED_STABLE_FRAGMENT_FOCUSES) {
      setTimeout(focusFragment, FRAGMENT_FOCUS_RETRY_MS);
    }
  };
  focusFragment();
}

/** Whether an editable element currently holds focus (guards the Cmd+, shortcut). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** Props for {@link SettingsShell}. */
export interface SettingsShellProps {
  /** Whether the current route is a settings route (drives the modal's open state). */
  readonly active: boolean;
  /** The routed page content — rendered plainly when inactive, inside the modal when active. */
  readonly children: ReactNode;
}

/** The settings modal shell. See the module remarks for the open/close/navigate model. */
export function SettingsShell({ active, children }: SettingsShellProps): JSX.Element {
  const router = useRouter();
  const pathname = useAppPathname();
  const { orgs } = useActiveOrg();
  const { orgId: selectedOrgId, isPersonal: selectedOrgIsPersonal } = useSettingsShellWorkspace();
  const [scrolled, setScrolled] = useState(false);

  const returnToRef = useRef(DEFAULT_CLOSE_TARGET);
  useEffect(() => {
    if (!active) returnToRef.current = pathname;
  }, [active, pathname]);

  useEffect(() => {
    if (!active) setScrolled(false);
  }, [active]);

  // Next can apply a route fragment after the dialog and its streamed section have mounted. The
  // history update does not emit `hashchange`, so keep a bounded destination-side retry window.
  useEffect(() => {
    if (!active) return;
    let attempts = 0;
    let stableFocuses = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const focusFragment = (): void => {
      const focused = focusSettingsHashTarget() || focusPendingRouteFragment();
      attempts += 1;
      stableFocuses = focused ? stableFocuses + 1 : 0;
      if (
        attempts < MAX_FRAGMENT_FOCUS_ATTEMPTS &&
        stableFocuses < REQUIRED_STABLE_FRAGMENT_FOCUSES
      ) {
        timer = setTimeout(focusFragment, FRAGMENT_FOCUS_RETRY_MS);
      }
    };
    timer = setTimeout(focusFragment, 0);
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [active, pathname]);

  const close = useMemo(
    () => (): void => {
      router.push(returnToRef.current);
    },
    [router],
  );

  // A single, independent Cmd+, listener — this codebase has no shared hotkey registry, so
  // `CommandPaletteProvider` and `AthenaPanelProvider` each install their own the same way.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key !== ',') return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      router.push(personalSectionHref(DEFAULT_PERSONAL_SETTINGS_SECTION));
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [router]);

  const workspaces = useMemo<readonly Workspace[]>(
    () => orgs.map((org) => ({ id: org.id, name: org.name, avatar: org.avatar })),
    [orgs],
  );

  if (!active) return <>{children}</>;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SettingsDialogContent
        className="p-0"
        onOpenAutoFocus={(event) => {
          if (!window.location.hash && !hasPendingRouteFragmentFocus()) return;
          event.preventDefault();
          stabilizeSettingsFragmentFocus();
        }}
      >
        <DialogDescription className="sr-only">
          Choose a section to update your personal or workspace settings.
        </DialogDescription>
        {/* `pr-14` reserves the close button's absolute 48px so the switcher never runs under it. */}
        <Surface
          as="header"
          tone={scrolled ? 'prominent' : 'raised'}
          shape="none"
          className="flex shrink-0 items-center gap-3 py-3 pr-14 pl-5 transition-colors motion-reduce:transition-none"
        >
          {/* The modal names itself, so it is the top of this outline — everything below is
              inside Settings. Radix defaults `Title` to an `h2`, which put it level with the open
              section's own title, the nav's group labels, and every subsection caption: four
              different things claiming the same rank, under no `h1` at all. */}
          <DialogTitle asChild>
            <h1 className="text-title-medium shrink-0">Settings</h1>
          </DialogTitle>
          {/*
           * The switcher's trigger is `w-full`, so it needs a box that bounds it: unbounded it
           * stretched the whole header and pushed its own chevron under the close button at every
           * width. `min-w-0` lets the workspace name truncate instead of forcing the row wider
           * than the panel; the cap keeps it chip-sized once there is room to spare.
           */}
          <div className="max-w-64 min-w-0 flex-1">
            <WorkspaceSwitcher
              workspaces={workspaces}
              onSelect={(orgId) => {
                router.push(sectionHref(orgId, DEFAULT_WORKSPACE_SETTINGS_SECTION));
              }}
              onCreate={() => {
                router.push(CREATE_WORKSPACE_PATH);
              }}
            />
          </div>
        </Surface>
        <SettingsPane
          onScrolledChange={setScrolled}
          renderNav={(onNavigate, content) => (
            <SettingsShellNav
              selectedOrgId={selectedOrgId}
              selectedOrgIsPersonal={selectedOrgIsPersonal}
              content={content}
              onNavigate={onNavigate}
            />
          )}
        >
          {children}
        </SettingsPane>
      </SettingsDialogContent>
    </Dialog>
  );
}
