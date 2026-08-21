'use client';

/**
 * Add template behavior to an existing entity's description editor.
 *
 * @remarks
 * The shared editor consumes an {@link EditorContribution}; it does not know what a template is.
 * This feature owns the template query, visibility rules, empty-state menu, slash commands, and
 * append semantics, then supplies them through that generic boundary.
 */
import type { TemplateOut, TemplateTargetType } from '@docket/types';
import { LayoutTemplate } from '@docket/ui/icons';
import type { Editor } from '@tiptap/react';
import { type JSX, useMemo } from 'react';

import { TemplateMenu } from '@/components/composer/template-menu';
import { sectionHref } from '@/components/settings/settings-registry';
import { templateMerge } from '@/components/templates/merge';
import {
  sortTemplates,
  templateMatchesContext,
  templatePatch,
  templatesOfKindDef,
} from '@/components/templates/queries';
import { useApiQuery } from '@/lib/query';

import type { EditorContribution } from './editor-contribution';
import { EntityDocument, type EntityDocumentProps } from './entity-document';

/** Input for {@link createDescriptionTemplateContribution}. */
export interface DescriptionTemplateContributionInput {
  /** The entity kind whose payload body each command may append. */
  readonly kind: TemplateTargetType;
  /** Templates already filtered to the current actor and team. */
  readonly templates: readonly TemplateOut[];
  /** Destination for the menu's template-management action. */
  readonly manageHref: string;
}

/** Append one template to the editor's live Markdown without discarding unsaved typing. */
function applyTemplate(
  editor: Editor,
  template: TemplateOut,
  kind: TemplateTargetType,
  range?: { readonly from: number; readonly to: number },
): void {
  if (range) editor.chain().focus().deleteRange(range).run();
  const current = editor.getMarkdown();
  const patch = templatePatch(template.payload, kind);
  const merged = templateMerge(
    { description: current },
    { description: patch.description },
    { document: 'description' },
  );
  if (typeof merged.description !== 'string') return;
  editor.commands.setContent(merged.description, { contentType: 'markdown' });
  editor.commands.focus('end');
}

/**
 * Build the template feature's polymorphic contribution to one editor instance.
 *
 * @param input - The filtered templates and their entity context.
 * @returns Empty-state UI and slash commands dispatched through the shared editor contracts.
 */
export function createDescriptionTemplateContribution({
  kind,
  templates,
  manageHref,
}: DescriptionTemplateContributionInput): EditorContribution {
  const ordered = sortTemplates(templates);
  return {
    id: `description-templates-${kind}`,
    renderEmptyAction: (editor) => (
      <TemplateMenu
        templates={ordered}
        manageHref={manageHref}
        disabled={false}
        triggerLabel="Start from template"
        compact
        showScopeLabels={false}
        onApply={(template) => {
          applyTemplate(editor, template, kind);
        }}
      />
    ),
    slashCommands: ordered.map((template) => ({
      id: `template-${template.id}`,
      label: template.name,
      hint: template.description ?? 'Append this template',
      keywords: ['template', template.name.toLowerCase()],
      icon: LayoutTemplate,
      requiresQuery: true,
      run: (editor, range) => {
        applyTemplate(editor, template, kind, range);
      },
    })),
  };
}

/** Props for a template-aware persisted entity document. */
export type TemplateAwareEntityDocumentProps = Omit<EntityDocumentProps, 'contributions'> & {
  /** The org whose templates to offer. */
  readonly orgId: string;
  /** The entity kind, which selects the template list and payload body. */
  readonly kind: TemplateTargetType;
  /** The signed-in member's Actor id, for personal-template visibility. */
  readonly currentActorId?: string | null;
  /** The entity's team, for team-template visibility. */
  readonly teamId?: string | null;
};

/**
 * Render an existing entity document with template behavior supplied as an editor contribution.
 *
 * @param props - The document and template visibility context.
 * @returns the shared document with a contribution when applicable templates exist.
 */
export function TemplateAwareEntityDocument({
  orgId,
  kind,
  currentActorId,
  teamId,
  ...documentProps
}: TemplateAwareEntityDocumentProps): JSX.Element {
  const query = useApiQuery({
    ...templatesOfKindDef(orgId, kind),
    enabled: documentProps.canEdit,
  });

  const templates = useMemo(() => {
    const all = query.data?.items ?? [];
    const withDescription = all.filter((template) =>
      Boolean(templatePatch(template.payload, kind).description),
    );
    if (currentActorId === undefined && teamId === undefined) return withDescription;
    return withDescription.filter((template) =>
      templateMatchesContext(template, currentActorId ?? null, teamId ?? null),
    );
  }, [query.data, kind, currentActorId, teamId]);

  const contribution = useMemo(
    () =>
      templates.length === 0
        ? null
        : createDescriptionTemplateContribution({
            kind,
            templates,
            manageHref: sectionHref(orgId, 'templates'),
          }),
    [kind, orgId, templates],
  );

  return (
    <EntityDocument
      {...documentProps}
      contributions={contribution === null ? [] : [contribution]}
    />
  );
}
