'use client';

/**
 * `settings` — the unified settings-modal nav: the Personal group, always, followed by whichever
 * workspace is selected in the switcher chip.
 *
 * @remarks
 * Replaces the two former nav components (`global-settings-section-nav.tsx`,
 * `settings-section-nav.tsx`), each of which rendered exactly one registry and could not show
 * Personal and Workspace sections together. This one always renders both: the Personal group is
 * workspace-independent and never changes; the Workspace groups below it are for whichever
 * workspace {@link useContextState} currently resolves to (route org, else last-used, else the
 * personal space — the same resolution the main sidebar's switcher already uses), so switching the
 * chip changes this nav's second half without navigating away from Personal settings.
 */
import { useContextState } from '@docket/ui/components';
import { useActiveOutlineEntry, useOutlineEntries } from '@docket/ui/hooks';
import { cn } from '@docket/ui';
import Link from '@/components/docket-link';
import { type JSX, useId, useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useAppPathname } from '@/lib/app-location';

import {
  PERSONAL_SETTINGS_GROUP,
  personalSectionHref,
  sectionHref,
  type SettingsSection,
  workspaceSettingsSectionGroups,
} from './settings-registry';
import { SETTINGS_GROUP_ATTR } from './settings-outline';
import { useCanManageOrg } from './use-can-manage-org';

/** Shared row layout for every settings link, personal or workspace. */
const ROW_BASE =
  'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-label-large transition-colors';

/**
 * Whether `href` is the section the viewer is currently on.
 *
 * @remarks
 * Matches the section route itself and anything nested beneath it, so a section that grows a
 * sub-route keeps its own row highlighted rather than un-highlighting the whole nav.
 */
export function isCurrentSection(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** One nav group with its sections already filtered for the viewer, and their routes resolved. */
export interface SettingsNavGroup {
  /** The group heading. */
  readonly label: string;
  /** The group's sections, filtered for what this viewer may manage. */
  readonly sections: readonly SettingsSection[];
  /** Build a section's absolute route. */
  readonly hrefFor: (section: SettingsSection) => string;
}

/**
 * The settings nav's content: the Personal group, then the selected workspace's groups.
 *
 * @remarks
 * Shared deliberately. The rail ({@link SettingsShellNav}) and the narrow-viewport
 * {@link SettingsSectionPicker} are two presentations of one list, and the audit finding that
 * produced the picker was about a section being unreachable — so letting the two derive their
 * sections independently would risk reintroducing exactly that defect in a form no screenshot
 * would show. One resolution, two renderers.
 */
export function useSettingsNavGroups({
  selectedOrgId,
  selectedOrgIsPersonal,
}: Pick<
  SettingsShellNavProps,
  'selectedOrgId' | 'selectedOrgIsPersonal'
>): readonly SettingsNavGroup[] {
  const { canManage } = useCanManageOrg(selectedOrgId ?? '');

  return useMemo(() => {
    const personal: SettingsNavGroup = {
      label: PERSONAL_SETTINGS_GROUP.label,
      sections: PERSONAL_SETTINGS_GROUP.sections,
      hrefFor: (section) => personalSectionHref(section.href),
    };
    if (!selectedOrgId) return [personal];

    const workspace = workspaceSettingsSectionGroups(selectedOrgIsPersonal)
      .map((group) => ({
        label: group.label,
        sections: group.sections.filter((section) => canManage || section.requiresManage !== true),
        hrefFor: (section: SettingsSection) => sectionHref(selectedOrgId, section.href),
      }))
      .filter((group) => group.sections.length > 0);

    return [personal, ...workspace];
  }, [canManage, selectedOrgId, selectedOrgIsPersonal]);
}

/** Props for {@link NavRow}. */
interface NavRowProps {
  /** The section's absolute route. */
  readonly href: string;
  /** The registry entry this row renders. */
  readonly section: SettingsSection;
  /** The open section's scroll container, for this row's outline while it is the current one. */
  readonly content: HTMLElement | null;
  /** Called once this row has been chosen, so a phone can leave the list for the section. */
  readonly onNavigate?: (() => void) | undefined;
}

/** One nav row (a real link), highlighted when its own route is the current page. */
function NavRow({ href, section, content, onNavigate }: NavRowProps): JSX.Element {
  const pathname = useAppPathname();
  const active = isCurrentSection(pathname, href);
  const Icon = section.icon;
  return (
    <li className="shrink-0">
      <Link
        href={href}
        onClick={() => onNavigate?.()}
        aria-current={active ? 'page' : undefined}
        className={cn(
          ROW_BASE,
          'focus-visible:ring-ring outline-none focus-visible:ring-2',
          active
            ? 'bg-surface-container-highest text-on-surface'
            : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{section.label}</span>
      </Link>
      {active ? <SectionOutline content={content} /> : null}
    </li>
  );
}

/** Props for {@link SectionOutline}. */
interface SectionOutlineProps {
  /** The open section's scroll container. */
  readonly content: HTMLElement | null;
}

/**
 * The open section's own groups, listed beneath it.
 *
 * @remarks
 * Indented under the section row rather than replacing it, so the rail keeps showing where you are
 * in the whole of Settings while it shows where you are inside one section. It renders nothing for
 * a section with fewer than two groups — see `useOutlineEntries`.
 *
 * @param props - The {@link SectionOutlineProps}.
 * @returns the rendered outline, or null when there is nothing to list.
 */
function SectionOutline({ content }: SectionOutlineProps): JSX.Element | null {
  const entries = useOutlineEntries(content, SETTINGS_GROUP_ATTR);
  const activeId = useActiveOutlineEntry(entries, content);

  if (entries.length === 0) return null;

  return (
    <ul className="mt-0.5 flex flex-col gap-0.5">
      {entries.map((entry) => {
        const current = entry.key === activeId;
        return (
          <li key={entry.key}>
            <button
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => {
                entry.element.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }}
              className={cn(
                'text-body-medium focus-visible:ring-ring flex min-h-8 w-full items-center rounded-md py-1 pr-2.5 pl-9 text-left outline-none focus-visible:ring-2',
                current
                  ? 'text-on-surface bg-surface-container-high'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
              )}
            >
              <span className="truncate">{entry.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Props for {@link NavGroup}. */
interface NavGroupProps {
  /** The group heading. */
  readonly label: string;
  /** The group's sections, already filtered for the current viewer. */
  readonly sections: readonly SettingsSection[];
  /** Build a section's absolute route. */
  readonly hrefFor: (section: SettingsSection) => string;
  /** The open section's scroll container, for the current row's outline. */
  readonly content: HTMLElement | null;
  /** Forwarded to each {@link NavRow}. */
  readonly onNavigate?: (() => void) | undefined;
}

/** A labelled group of {@link NavRow}s. */
function NavGroup({
  label,
  sections,
  hrefFor,
  content,
  onNavigate,
}: NavGroupProps): JSX.Element | null {
  const labelId = useId();
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-on-surface-variant text-label-medium px-2.5">
        {label}
      </span>
      <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
        {sections.map((section) => (
          <NavRow
            key={section.key}
            href={hrefFor(section)}
            section={section}
            content={content}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

/** Props for {@link SettingsShellNav}. */
export interface SettingsShellNavProps {
  /** The workspace currently selected in the settings modal's switcher chip, or `null`. */
  readonly selectedOrgId: string | null;
  /** Whether that workspace is the caller's personal space. */
  readonly selectedOrgIsPersonal: boolean;
  /**
   * The open section's scroll container.
   *
   * @remarks
   * The rail reads the section's own group headings out of this to build its sub-navigation, which
   * is what keeps the two from ever disagreeing — see `settings-outline.tsx`.
   */
  readonly content: HTMLElement | null;
  /**
   * Called once a section row has been chosen.
   *
   * @remarks
   * Only the phone's two-level pane has anything to do here — the desktop rail sits beside the
   * content it is navigating, so there is no view to leave.
   */
  readonly onNavigate?: (() => void) | undefined;
}

/**
 * The full settings-modal nav: Personal, then the selected workspace's groups.
 *
 * @remarks
 * One component serves both presentations {@link SettingsPane} lays out — the rail beside the
 * content from `sm` up, and the whole pane on a phone browsing for a section. It renders the same
 * markup either way; only its box changes across the breakpoint.
 */
export function SettingsShellNav({
  selectedOrgId,
  selectedOrgIsPersonal,
  content,
  onNavigate,
}: SettingsShellNavProps): JSX.Element {
  const groups = useSettingsNavGroups({ selectedOrgId, selectedOrgIsPersonal });

  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-5">
      {groups.map((group) => (
        <NavGroup
          key={group.label}
          label={group.label}
          sections={group.sections}
          hrefFor={group.hrefFor}
          content={content}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

/** The workspace the settings modal's switcher chip should show. */
export interface SettingsShellWorkspace {
  /** The resolved workspace id, or `null` before the org list loads. */
  readonly orgId: string | null;
  /** Whether that workspace is the caller's personal space. */
  readonly isPersonal: boolean;
}

/** Resolve the workspace the settings modal's switcher chip should show. */
export function useSettingsShellWorkspace(): SettingsShellWorkspace {
  const { activeOrgId } = useContextState();
  const { orgs } = useActiveOrg();
  const selected = orgs.find((org) => org.id === activeOrgId) ?? null;
  return { orgId: selected?.id ?? null, isPersonal: selected?.isPersonal ?? false };
}
