'use client';

/**
 * Settings → Templates: where every template in the workspace is created, edited, and deleted.
 *
 * @remarks
 * The list is grouped by the kind each template creates, because that is the only question a
 * reader arrives with — "what do I have for tasks?" — and because it matches how the composer
 * pickers slice the same data. Rows separate by a tonal step on the surface ramp rather than by
 * rules; see `docs/design/design-system.md` on borders.
 *
 * A shipped default carries no badge. Docket seeds three per kind on the workspace's first read,
 * and from that moment they are ordinary rows: rename them, rewrite them, delete them. Marking
 * them would imply a distinction the API does not enforce and the product does not intend.
 */
import type { TemplateOut, TemplateTargetType } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  menuDestructiveItem,
} from '@docket/ui/primitives';
import { Copy, Edit, Ellipsis, LayoutTemplate, Plus, Trash2 } from '@docket/ui/icons';
import { type JSX, useState } from 'react';

import { EmptyState as SharedEmptyState } from '@docket/ui/components';
import { LoadFailure } from '@/components/settings/load-failure';
import { SettingRow } from '@/components/settings/setting-row';
import { SettingsGroup } from '@/components/settings/settings-group';
import { firstWriteError, WriteError } from '@/components/settings/write-error';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { TemplateEditorDialog } from '@/components/templates/template-editor';
import {
  sortTemplates,
  templatesDef,
  useCreateTemplate,
  useDeleteTemplate,
} from '@/components/templates/queries';
import { useTypedRoute } from '@/lib/app-location';
import { userErrorMessage } from '@/lib/problem';
import { useApiListQuery } from '@/lib/query';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The kinds a template may create, in the order the page lists them. */
const KIND_ORDER: readonly TemplateTargetType[] = ['task', 'project', 'initiative', 'program'];

/** How each scope reads on a row. */
const SCOPE_LABEL: Record<TemplateOut['scope'], string> = {
  organization: 'Workspace',
  team: 'Team',
  personal: 'Only you',
};

/** Which template the editor is open on, and for which kind. */
interface EditorTarget {
  targetType: TemplateTargetType;
  template: TemplateOut | null;
}

/**
 * Manage the workspace's reusable create drafts.
 *
 * @remarks
 * Reads the org id from the generated typed route rather than taking Next's `params` promise as a prop. The
 * offline route table mounts every route with no props at all — offline there is no server to
 * resolve that promise — so a page with a props signature reads `undefined` the moment it renders
 * without a network. See `scripts/offline-route-policy.ts`.
 */
export default function TemplatesSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/templates');
  const query = useApiListQuery(templatesDef(orgId));
  const duplicate = useCreateTemplate(orgId);
  const remove = useDeleteTemplate(orgId);

  const writeError = firstWriteError([
    [duplicate, 'Could not duplicate that template.'],
    [remove, 'Could not delete that template.'],
  ]);

  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<TemplateOut | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const templates = query.data?.items ?? [];

  return (
    <SettingsSectionPage
      title="Templates"
      description="Reusable starting points. Pick one from the Template menu in any create dialog."
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button">
              <Plus />
              New template
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {KIND_ORDER.map((kind) => (
              <NewTemplateItem
                key={kind}
                kind={kind}
                onSelect={() => {
                  setEditing({ targetType: kind, template: null });
                }}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {writeError ? <WriteError message={writeError} /> : null}
      {query.isPending ? (
        <Skeleton className="h-96 max-w-3xl rounded-xl" />
      ) : query.isError ? (
        <LoadFailure
          message={userErrorMessage(query.error, 'Could not load templates.')}
          retrying
        />
      ) : templates.length === 0 ? (
        <EmptyState
          onCreate={() => {
            setEditing({ targetType: 'task', template: null });
          }}
        />
      ) : (
        <div className="flex max-w-3xl flex-col gap-8">
          {KIND_ORDER.map((kind) => (
            <KindGroup
              key={kind}
              kind={kind}
              templates={sortTemplates(templates.filter((t) => t.targetType === kind))}
              onCreate={() => {
                setEditing({ targetType: kind, template: null });
              }}
              onEdit={(template) => {
                setEditing({ targetType: kind, template });
              }}
              onDuplicate={(template) => {
                duplicate.mutate({
                  targetType: template.targetType,
                  name: `${template.name} copy`,
                  ...(template.description ? { description: template.description } : {}),
                  scope: template.scope,
                  payload: template.payload,
                });
              }}
              onDelete={(template) => {
                setDeleteError(null);
                setDeleting(template);
              }}
            />
          ))}
        </div>
      )}

      {editing ? (
        <TemplateEditorDialog
          orgId={orgId}
          targetType={editing.targetType}
          template={editing.template}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDestructiveDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="Delete this template?"
        description={
          deleting
            ? `"${deleting.name}" disappears from every create dialog. Work already made from it is untouched.`
            : ''
        }
        confirmLabel="Delete template"
        pending={remove.isPending}
        error={deleteError}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
            },
            onError: (caught) => {
              setDeleteError(userErrorMessage(caught, 'Could not delete the template.'));
            },
          });
        }}
      />
    </SettingsSectionPage>
  );
}

/** One "New … template" menu row, named in the workspace's own vocabulary. */
function NewTemplateItem({
  kind,
  onSelect,
}: {
  kind: TemplateTargetType;
  onSelect: () => void;
}): JSX.Element {
  const noun = useVocabulary(kind);
  return <DropdownMenuItem onSelect={onSelect}>{noun}</DropdownMenuItem>;
}

/** One kind's heading and its rows. */
function KindGroup({
  kind,
  templates,
  onCreate,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  kind: TemplateTargetType;
  templates: readonly TemplateOut[];
  onCreate: () => void;
  onEdit: (template: TemplateOut) => void;
  onDuplicate: (template: TemplateOut) => void;
  onDelete: (template: TemplateOut) => void;
}): JSX.Element {
  const noun = useVocabulary(kind, { plural: true });

  return (
    <SettingsGroup title={noun} body="rows">
      {templates.length === 0 ? (
        <SettingRow
          label={<span className="text-on-surface-variant">No templates yet.</span>}
          trailing={
            <Button type="button" variant="ghost" size="sm" onClick={onCreate}>
              Add one
            </Button>
          }
        />
      ) : (
        <ul>
          {templates.map((template) => (
            <li
              key={template.id}
              className="bg-surface-container-low hover:bg-surface-container flex items-center gap-3 rounded-xl px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-on-surface text-body-large truncate">{template.name}</span>
                {template.description ? (
                  <span className="text-on-surface-variant text-body-medium truncate">
                    {template.description}
                  </span>
                ) : null}
              </div>
              <span className="text-on-surface-variant text-label-medium ml-auto shrink-0">
                {SCOPE_LABEL[template.scope]}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    aria-label={`Actions for ${template.name}`}
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      onEdit(template);
                    }}
                  >
                    <Edit />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      onDuplicate(template);
                    }}
                  >
                    <Copy />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={menuDestructiveItem()}
                    onSelect={() => {
                      onDelete(template);
                    }}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}

/**
 * The state a workspace reaches only by deleting everything it was given.
 *
 * @remarks
 * Docket seeds twelve templates on first read, so this is not the state a new workspace sees. It
 * still has to teach rather than announce a count of zero, because the person looking at it has
 * just cleared the shelf and needs to know what goes back on it.
 */
function EmptyState({ onCreate }: { onCreate: () => void }): JSX.Element {
  return (
    <SettingsGroup>
      <SharedEmptyState
        icon={LayoutTemplate}
        title="No templates in this workspace"
        body="A template pre-fills a create dialog — the outline of a bug report, the properties of a launch. Make one and it appears in the Template menu wherever that kind of work is created."
        frame="none"
        cta={{ label: 'New template', onClick: onCreate }}
      />
    </SettingsGroup>
  );
}
