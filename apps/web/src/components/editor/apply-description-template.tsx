'use client';

/**
 * Apply a template's description to an entity that already exists.
 *
 * @remarks
 * `ComposerTemplateControl` (`@/components/composer/template-menu`) applies a template while a
 * task/project/initiative/program is still an unsaved draft. This is the same idea for an entity
 * that has already been created: pick a template, and its description is appended — never
 * substituted — to whatever is already written, via the same {@link templateMerge} the composers
 * use. Simpler than the composer control because there is no dialog lifecycle to track: no `open`
 * gate, no `?template=` auto-apply, no visibility reporting back to a parent shell.
 */
import type { TemplateTargetType } from '@docket/types';
import { type JSX, useMemo } from 'react';

import { TemplateMenu } from '@/components/composer/template-menu';
import { templateMerge } from '@/components/composer/use-composer-draft';
import { sectionHref } from '@/components/settings/settings-registry';
import {
  templateMatchesContext,
  templatePatch,
  templatesOfKindDef,
} from '@/components/templates/queries';
import { useApiQuery } from '@/lib/query';

/** Props for {@link ApplyDescriptionTemplateControl}. */
export interface ApplyDescriptionTemplateControlProps {
  /** The org whose templates to offer. */
  orgId: string;
  /** The entity's kind, which selects the template list and the payload fields to read. */
  kind: TemplateTargetType;
  /** Whether the viewer may edit the entity's description — the only gate this control needs. */
  canEdit: boolean;
  /** The entity's current description, appended to rather than replaced. */
  current: string | null | undefined;
  /**
   * The signed-in member's Actor id in this org, for personal-template scoping.
   *
   * @remarks
   * `undefined` (together with `teamId` also `undefined`) shows every template of this kind,
   * unfiltered — the same fallback `ComposerTemplateControl` uses for mounts that cannot resolve a
   * scope. Pass `null` deliberately to exclude personal templates until a scope is known.
   */
  currentActorId?: string | null;
  /**
   * The entity's team, for team-template scoping.
   *
   * @remarks
   * Only tasks and projects have a team. Leave `undefined` for initiatives and programs, which
   * have no team concept to scope by.
   */
  teamId?: string | null;
  /** Persist the merged description. */
  onApply: (next: string) => void;
}

/**
 * The description card's template control.
 *
 * @param props - The {@link ApplyDescriptionTemplateControlProps}.
 * @returns the rendered control, or nothing while the viewer cannot edit, the read is still
 * pending, or no template of this kind carries a description to apply.
 */
export function ApplyDescriptionTemplateControl({
  orgId,
  kind,
  canEdit,
  current,
  currentActorId,
  teamId,
  onApply,
}: ApplyDescriptionTemplateControlProps): JSX.Element | null {
  const query = useApiQuery({ ...templatesOfKindDef(orgId, kind), enabled: canEdit });

  const templates = useMemo(() => {
    const all = query.data?.items ?? [];
    // A template with no description would be a menu entry that does nothing on select.
    const withDescription = all.filter((template) =>
      Boolean(templatePatch(template.payload, kind).description),
    );
    if (currentActorId === undefined && teamId === undefined) return withDescription;
    return withDescription.filter((template) =>
      templateMatchesContext(template, currentActorId ?? null, teamId ?? null),
    );
  }, [query.data, kind, currentActorId, teamId]);

  // A pending, failed, or empty read renders nothing rather than a disabled control — this is an
  // accelerant for a description already being edited, not a feature someone is waiting on.
  if (!canEdit || templates.length === 0) return null;

  return (
    <TemplateMenu
      templates={templates}
      manageHref={sectionHref(orgId, 'templates')}
      disabled={false}
      onApply={(template) => {
        const patch = templatePatch(template.payload, kind);
        const merged = templateMerge(
          { description: current ?? null },
          { description: patch.description },
          { document: 'description' },
        );
        if (typeof merged.description === 'string') onApply(merged.description);
      }}
    />
  );
}
