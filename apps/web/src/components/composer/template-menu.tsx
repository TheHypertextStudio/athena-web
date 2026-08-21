'use client';

/**
 * The shared template picker for create composers and empty persisted descriptions.
 *
 * @remarks
 * ## Why a menu and not a chip row
 *
 * `docs/design/design-system.md` assigns template pickers to the MD3 suggestion-chip register.
 * That is right for a fixed set of two or three and wrong here. A workspace ships with three
 * templates per kind and may author any number beyond that, so the control has to hold an
 * unbounded list, group it by who can see each entry, and carry a route out to where templates
 * are managed. A row of chips does none of those things, and a wrapping row of nine chips is what
 * `packages/ui/src/primitives/chip.tsx` was written to stop.
 *
 * ## Why create composers use the top row and not the property strip
 *
 * Every pill in the strip sets one field. A template rewrites the draft. The old initiative
 * picker sat among the pills — and below the description it silently overwrote — which is exactly
 * how a control with that reach comes to look like one without it.
 */
import type { TemplateOut, TemplateTargetType } from '@docket/types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { ChevronDown, LayoutTemplate, Settings } from '@docket/ui/icons';
import Link from 'next/link';
import { type JSX, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { sectionHref } from '@/components/settings/settings-registry';
import {
  sortTemplates,
  templateMatchesContext,
  templatesOfKindDef,
} from '@/components/templates/queries';
import { useApiQuery } from '@/lib/query';

// Keep the legacy shell's visibility state in sync before the browser paints on the client, while
// retaining a server-safe passive hook for Next's server render.
const usePrePaintEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** How each scope is titled where templates are grouped. */
const SCOPE_LABEL: Record<TemplateOut['scope'], string> = {
  organization: 'Workspace',
  team: 'Team',
  personal: 'Yours',
};

/** The order groups appear in — shared before private, since shared is the common case. */
const SCOPE_ORDER: readonly TemplateOut['scope'][] = ['organization', 'team', 'personal'];

/** Props for {@link TemplateMenu}. */
export interface TemplateMenuProps {
  /** The templates that create this composer's kind. */
  templates: readonly TemplateOut[];
  /** Apply a template to the draft. */
  onApply: (template: TemplateOut) => void;
  /** Where "Manage templates…" leads (the workspace's Templates settings). */
  manageHref: string;
  /** Close a shell-global composer before the persistent shell navigates to settings. */
  onManage?: (() => void) | undefined;
  /** Whether the composer is submitting, which disables the control with everything else. */
  disabled: boolean;
  /** Trigger copy for the surface using the menu. Defaults to “Template”. */
  triggerLabel?: string;
  /** Use the editor-inline control size instead of the composer's top-row size. */
  compact?: boolean;
  /** Show visibility-scope group headings. Defaults to true. */
  showScopeLabels?: boolean;
}

/**
 * The shared template dropdown.
 *
 * @param props - The {@link TemplateMenuProps}.
 * @returns the rendered control, or nothing at all when the workspace has no templates for this
 * kind and no way to reach the manage screen would help — an empty menu is worse than no menu.
 */
export function TemplateMenu({
  templates,
  onApply,
  manageHref,
  onManage,
  disabled,
  triggerLabel = 'Template',
  compact = false,
  showScopeLabels = true,
}: TemplateMenuProps): JSX.Element | null {
  if (templates.length === 0) return null;

  const ordered = sortTemplates(templates);
  const groups = SCOPE_ORDER.map((scope) => ({
    scope,
    items: ordered.filter((template) => template.scope === scope),
  })).filter((group) => group.items.length > 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? undefined : 'sm'}
          controlSize={compact ? 'sm' : undefined}
          disabled={disabled}
          className="text-on-surface-variant max-w-56"
        >
          <LayoutTemplate className="size-4 shrink-0" />
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {groups.map((group) => (
          <div key={group.scope}>
            {showScopeLabels ? (
              <DropdownMenuLabel>{SCOPE_LABEL[group.scope]}</DropdownMenuLabel>
            ) : null}
            {group.items.map((template) => (
              <DropdownMenuItem
                key={template.id}
                onSelect={() => {
                  onApply(template);
                }}
                {...(template.description ? { supporting: template.description } : {})}
              >
                {template.name}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={manageHref} {...(onManage !== undefined ? { onClick: onManage } : {})}>
            <Settings />
            Manage templates…
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Props for {@link ComposerTemplateControl}. */
export interface ComposerTemplateControlProps {
  /** The org whose templates to offer (from the route). */
  orgId: string;
  /** The kind this composer creates. */
  kind: TemplateTargetType;
  /** Whether the composer is open — the read is skipped while it is not. */
  open: boolean;
  /** Apply a template to the draft. */
  onApply: (template: TemplateOut) => void;
  /**
   * The signed-in member's Actor id in this destination workspace.
   *
   * @remarks
   * When supplied, personal templates belonging to another member are excluded. `undefined`
   * preserves the legacy page-owned menu behavior until that composer migrates to a destination
   * context that can identify the selected member.
   */
  currentActorId?: string | null | undefined;
  /**
   * The task's selected team in this destination workspace.
   *
   * @remarks
   * When supplied, team templates are offered only for this team. `undefined` preserves the
   * legacy page-owned menu behavior; `null` deliberately hides team-scoped templates while the
   * destination has no resolved team.
   */
  teamId?: string | null | undefined;
  /**
   * Decorative content to render only when this control itself is rendered.
   *
   * @remarks
   * Global context rows use this for the separator before Template. Keeping it inside this
   * data-connected control means pending and empty template lists cannot leave a dangling glyph.
   */
  leadingSeparator?: ReactNode | undefined;
  /**
   * A template to apply as soon as the list loads, from a `?template=` compose request.
   *
   * @remarks
   * Applied once per open. A command palette entry that says "New task from Bug report" has to
   * deliver the bug-report outline, and the page it lands on cannot know the payload until this
   * read resolves.
   */
  autoApplyId?: string | null | undefined;
  /** Report whether this data-connected control renders a visible template menu. */
  onVisibilityChange?: ((visible: boolean) => void) | undefined;
  /** Close a shell-global composer before navigating to template settings. */
  onManage?: (() => void) | undefined;
  /** Whether the composer is submitting. */
  disabled: boolean;
}

/**
 * The data-connected template control every create composer mounts.
 *
 * @remarks
 * The composers each supply `kind` and an `onApply` that merges into their own draft; everything
 * else — the read, the ordering, the manage link, the auto-apply, the empty case — lives here, so
 * the four composers cannot drift apart in how templates behave.
 *
 * @param props - The {@link ComposerTemplateControlProps}.
 * @returns the rendered control, or nothing when the workspace has no templates of this kind.
 */
export function ComposerTemplateControl({
  orgId,
  kind,
  open,
  onApply,
  currentActorId,
  teamId,
  leadingSeparator,
  autoApplyId = null,
  onVisibilityChange,
  onManage,
  disabled,
}: ComposerTemplateControlProps): JSX.Element | null {
  const query = useApiQuery({ ...templatesOfKindDef(orgId, kind), enabled: open });
  const items = query.data?.items;
  // Memoized so the auto-apply effect below is not re-entered on every unrelated render.
  const templates = useMemo(() => {
    const all = items ?? [];
    // Legacy page-owned composer mounts have no selected-person context yet, so keep their
    // existing visibility unchanged. A migrated global composer passes both values and makes the
    // server's intentionally broad read safe for the destination currently on screen.
    if (currentActorId === undefined && teamId === undefined) return all;
    return all.filter((template) =>
      templateMatchesContext(template, currentActorId ?? null, teamId ?? null),
    );
  }, [currentActorId, items, teamId]);

  // Guarded by a ref so a re-render after the merge does not apply the same template twice.
  const autoApplied = useRef(false);
  useEffect(() => {
    if (!autoApplyId || autoApplied.current) return;
    const match = templates.find((template) => template.id === autoApplyId);
    if (!match) return;
    autoApplied.current = true;
    onApply(match);
  }, [autoApplyId, templates, onApply]);

  // Legacy shell layout needs the result of this data-dependent render decision, not merely the
  // ReactNode it was handed. Run before paint so cached templates reopening a dialog do not flash
  // the no-context spacing, and include every scope input so a changed person or team clears it.
  const visible = open && templates.length > 0;
  usePrePaintEffect(() => {
    onVisibilityChange?.(visible);
  }, [currentActorId, kind, onVisibilityChange, open, orgId, teamId, visible]);

  // A failed or pending read renders nothing rather than a disabled control. The composer's job
  // is creating the entity; a template is an accelerant, and a broken accelerant should get out
  // of the way instead of sitting there greyed out asking to be understood.
  if (!visible) return null;

  return (
    <>
      {leadingSeparator}
      <TemplateMenu
        templates={templates}
        onApply={onApply}
        manageHref={sectionHref(orgId, 'templates')}
        onManage={onManage}
        disabled={disabled}
      />
    </>
  );
}
