'use client';
import type { WorkTemplateDraftFields } from './work-template-draft';
import type { ReactNode } from 'react';
import { useTemplateApplication } from './use-template-application';
import { ComposerTemplateSelection } from './composer-template-selection';

/**
 * `useComposerTemplateContribution` — the template control a create composer shows in its empty
 * description.
 *
 * @remarks
 * The task, project, initiative, and program composers each mount the same
 * {@link ComposerTemplateControl} inside their body editor through an {@link EditorContribution},
 * and each derived the control's props from the same host facts in the same way. This hook owns
 * that derivation so a composer only names its kind, its merge rule, and the facts it has.
 *
 * The editor keys contributions by `id` and renders the empty-state action afresh each time, so
 * the contribution is rebuilt per render and its callbacks may close over the latest props.
 *
 * Loading a saved draft never re-applies a launcher's `defaultTemplateId`: the draft is the whole
 * of what the composer should show, and a template merged on top of it would change a draft the
 * person had already shaped.
 */
import type { TemplateDraft, TemplateTargetType } from '@docket/work/template-contract';

import type { EditorContribution } from '@/components/editor/editor-contribution';
import { type PartialWithUndefined, type TemplateMergeRule } from '@/components/templates/merge';

import { ComposerTemplateControl } from './template-menu';

/** The facts a shell-global host contributes; a page-mounted composer has none. */
export interface TemplateHostFacts {
  /** The signed-in member's Actor id in the destination, for personal templates. */
  readonly currentActorId: string | null;
}

/** What the hook needs from the composer. */
export interface ComposerTemplateContributionOptions<T extends object> {
  readonly kind: TemplateTargetType;
  readonly selection?: WorkTemplateDraftFields | undefined;
  readonly orgId: string;
  readonly open: boolean;
  /** Whether the destination workspace and its creation data have resolved. */
  readonly destinationReady: boolean;
  /** The global host's facts, or undefined for a page-mounted composer. */
  readonly host: TemplateHostFacts | undefined;
  /** Whether the launcher's contextual defaults still apply to the selected destination. */
  readonly contextualDefaultsApply: boolean;
  /** A template the launcher asked to apply on open. */
  readonly defaultTemplateId: string | null;
  /** The draft the host asked the composer to reopen, which takes precedence over a template. */
  readonly resumeDraftId: string | null | undefined;
  /** The team scoping team-owned templates, for composers whose record belongs to a team. */
  readonly teamId: string | null;
  readonly creating: boolean;
  /** Whether the record was already created, after which templates no longer apply. */
  readonly committed?: boolean | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly updateDraft: (recipe: (current: T) => Partial<T>) => void;
  /** Turn a template's stored draft into a patch for this composer's draft. */
  readonly patch: (payload: TemplateDraft) => PartialWithUndefined<T>;
  /** Which field appends and which fill only while blank. */
  readonly rule: TemplateMergeRule<T>;
}

/**
 * Build the body editor's template contribution for one composer.
 *
 * @returns an {@link EditorContribution} for the composer's `bodyContributions`.
 */
export function useComposerTemplateContribution<T extends object>({
  kind,
  selection,
  orgId,
  open,
  destinationReady,
  host,
  contextualDefaultsApply,
  defaultTemplateId,
  resumeDraftId,
  teamId,
  creating,
  committed = false,
  onOpenChange,
  updateDraft,
  patch,
  rule,
}: ComposerTemplateContributionOptions<T>): EditorContribution & { selection: ReactNode } {
  const resuming = resumeDraftId !== null && resumeDraftId !== undefined;
  const hosted = host !== undefined;

  const application = useTemplateApplication({
    orgId,
    kind,
    teamId,
    open: open && destinationReady,
    updateDraft,
    patch,
    rule,
  });
  return {
    id: `composer-description-templates-${kind}`,
    selection: (
      <ComposerTemplateSelection
        orgId={orgId}
        kind={kind}
        teamId={teamId}
        selection={selection}
        disabled={creating || committed || !destinationReady}
        application={application}
      />
    ),
    renderEmptyAction: () => (
      <ComposerTemplateControl
        orgId={orgId}
        kind={kind}
        open={open && destinationReady}
        autoApplyId={contextualDefaultsApply && !resuming ? defaultTemplateId : null}
        currentActorId={host?.currentActorId}
        teamId={hosted ? teamId : undefined}
        inline
        onManage={
          hosted
            ? () => {
                onOpenChange(false);
              }
            : undefined
        }
        canonicalTemplates={application.publications}
        applicationReady={application.ready}
        onApply={application.legacy}
        disabled={creating || committed || !destinationReady}
      />
    ),
  };
}
