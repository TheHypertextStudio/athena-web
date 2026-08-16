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
} from '@docket/ui/primitives';
import { type Workspace, WorkspaceSwitcher } from '@docket/ui/components';
import { useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useEffect, useMemo, useRef } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useAppPathname } from '@/lib/app-location';
import { CREATE_WORKSPACE_PATH } from '@/lib/workspace-creation';

import {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  DEFAULT_WORKSPACE_SETTINGS_SECTION,
  personalSectionHref,
  sectionHref,
} from './settings-registry';
import { SettingsPane } from './settings-pane';
import { SettingsShellNav, useSettingsShellWorkspace } from './settings-shell-nav';

/** The pathname to fall back to when settings was opened with no prior page (a direct link). */
const DEFAULT_CLOSE_TARGET = '/today';

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

  const returnToRef = useRef(DEFAULT_CLOSE_TARGET);
  useEffect(() => {
    if (!active) returnToRef.current = pathname;
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
      <SettingsDialogContent className="p-0">
        <DialogDescription className="sr-only">
          Choose a section to update your personal or workspace settings.
        </DialogDescription>
        {/* `pr-14` reserves the close button's absolute 48px so the switcher never runs under it. */}
        <div className="flex shrink-0 items-center gap-3 py-3 pr-14 pl-5">
          <DialogTitle className="text-title-medium shrink-0">Settings</DialogTitle>
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
        </div>
        <SettingsPane
          renderNav={(onNavigate) => (
            <SettingsShellNav
              selectedOrgId={selectedOrgId}
              selectedOrgIsPersonal={selectedOrgIsPersonal}
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
