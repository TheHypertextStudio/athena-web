'use client';

/**
 * The picker that attaches a message Athena received to a piece of Docket work.
 *
 * @remarks
 * A received message is a context object, not an email, so this dialog talks about *attaching it
 * to something* rather than about mail: pick a workspace, find the task, project, or initiative,
 * attach. It is the same shape as any other "link this thing to that thing" flow in the product,
 * which is the point — an Athena email lands in the ordinary attachment list on the entity, so
 * the person who opens that task later needs no idea it came from a mailbox.
 *
 * Search is workspace-scoped because Docket's search is, so the workspace choice comes first and
 * defaults to the one the message was filed into — which is right nearly always, and cheap to
 * change when it is not.
 */
import { OrganizationId, type AttachmentSubjectType, type SearchOut } from '@docket/types';
import { Folder, Search as SearchIcon, TaskAlt, Target } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Text,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, STALE, unwrap } from '@/lib/query-core';
import { queryKeys, useApiMutation, useApiQuery } from '@/lib/query';

import { attachMessage, mailAttachmentsKey, mailListKey, mailMessageKey } from './mail-query-defs';

/** One thing a received message can be attached to. */
interface AttachCandidate {
  readonly subjectType: AttachmentSubjectType;
  readonly subjectId: string;
  readonly title: string;
}

/** Props for {@link MailAttachDialog}. */
export interface MailAttachDialogProps {
  /** Whether the dialog is open; the host owns this state. */
  readonly open: boolean;
  /** Notify the host that the open state changed. */
  readonly onOpenChange: (open: boolean) => void;
  /** The received message being attached. */
  readonly messageId: string;
  /** The message's subject, shown so the person can see what they are attaching. */
  readonly messageTitle: string;
  /** The workspace the message was filed into — the default place to look. */
  readonly defaultOrganizationId: string;
}

/** The search-result kinds that can host an attachment. */
const ATTACHABLE_KINDS = new Set(['task', 'project', 'initiative']);

/** Reduce a workspace search response to the entities an attachment can hang off. */
function toCandidates(result: SearchOut | undefined): readonly AttachCandidate[] {
  if (!result) return [];
  const seen = new Set<string>();
  const out: AttachCandidate[] = [];
  for (const hit of result.items) {
    if (!ATTACHABLE_KINDS.has(hit.kind)) continue;
    const route = hit.route;
    if (route.type !== 'entity') continue;
    const key = `${hit.kind}:${route.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      subjectType: hit.kind as AttachmentSubjectType,
      subjectId: route.entityId,
      title: hit.title,
    });
  }
  return out;
}

/** The leading glyph for each attachable kind. */
function kindIcon(kind: AttachmentSubjectType): JSX.Element {
  if (kind === 'project') return <Folder aria-hidden="true" className="size-4" />;
  if (kind === 'initiative') return <Target aria-hidden="true" className="size-4" />;
  return <TaskAlt aria-hidden="true" className="size-4" />;
}

/** Human label for each attachable kind. */
const KIND_LABEL: Readonly<Record<AttachmentSubjectType, string>> = {
  task: 'Task',
  project: 'Project',
  initiative: 'Initiative',
};

/**
 * Attach one received message to a task, project, or initiative.
 *
 * @param props - See {@link MailAttachDialogProps}.
 * @returns the attach dialog.
 */
export function MailAttachDialog({
  open,
  onOpenChange,
  messageId,
  messageTitle,
  defaultOrganizationId,
}: MailAttachDialogProps): JSX.Element {
  const [organizationId, setOrganizationId] = useState(defaultOrganizationId);
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (open) {
      setOrganizationId(defaultOrganizationId);
      setTerm('');
    }
  }, [open, defaultOrganizationId]);

  const orgsQ = useApiQuery(
    apiQueryOptions(queryKeys.orgs(), () => api.v1.orgs.$get(), 'Could not load your workspaces.', {
      staleTime: STALE.static,
      enabled: open,
    }),
  );
  const workspaces = orgsQ.data?.items ?? [];

  const searchQ = useApiQuery(
    apiQueryOptions(
      ['orgs', organizationId, 'search', 'attach', term] as const,
      () =>
        api.v1.orgs[':orgId'].search.$get({
          param: { orgId: organizationId },
          query: { q: term },
        }),
      'Could not search this workspace.',
      { staleTime: STALE.volatile, enabled: open && organizationId.length > 0 && term.length > 1 },
    ),
  );
  const candidates = useMemo(() => toCandidates(searchQ.data), [searchQ.data]);

  const attachM = useApiMutation({
    mutationFn: (candidate: AttachCandidate) =>
      unwrap(
        () =>
          attachMessage(messageId, {
            subjectType: candidate.subjectType,
            subjectId: candidate.subjectId,
            // The workspace id arrives here as a plain string from a <select>. Parsing it back
            // into its branded form is a real check, not a cast: a value that is not a workspace
            // id fails here instead of at the API.
            organizationId: OrganizationId.parse(organizationId),
          }),
        'Could not attach this message.',
      ),
    invalidateKeys: [mailAttachmentsKey(messageId), mailMessageKey(messageId), mailListKey],
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  const attachError = attachM.error
    ? userErrorMessage(attachM.error, 'Could not attach this message.')
    : null;
  const searchError = searchQ.error
    ? userErrorMessage(searchQ.error, 'Could not search this workspace.')
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (attachM.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach to work</DialogTitle>
          <DialogDescription>
            Attach “{messageTitle}” to a task, project, or initiative so it shows up where the work
            happens.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Workspace">
            <Select
              controlSize="lg"
              value={organizationId}
              onChange={(e) => {
                setOrganizationId(e.currentTarget.value);
              }}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Find the work"
            description="Type at least two characters to search this workspace."
          >
            <Input
              controlSize="lg"
              variant="filled"
              value={term}
              placeholder="Search tasks, projects, initiatives"
              onChange={(e) => {
                setTerm(e.currentTarget.value);
              }}
            />
          </Field>

          <div className="flex min-h-40 flex-col gap-1">
            {searchError ? (
              <Text as="p" token="body-small" tone="error" role="alert">
                {searchError}
              </Text>
            ) : null}
            {term.length <= 1 ? (
              <ControlGroup controlSize="sm" className="text-on-surface-variant">
                <SearchIcon aria-hidden="true" className="size-4" />
                <Text token="body-small" tone="muted">
                  Search to find the task or project this belongs to.
                </Text>
              </ControlGroup>
            ) : searchQ.isPending ? (
              <Text token="body-small" tone="muted">
                Searching…
              </Text>
            ) : candidates.length === 0 ? (
              <Text token="body-small" tone="muted">
                Nothing in this workspace matched.
              </Text>
            ) : (
              candidates.map((candidate) => (
                <button
                  key={`${candidate.subjectType}:${candidate.subjectId}`}
                  type="button"
                  disabled={attachM.isPending}
                  onClick={() => {
                    attachM.mutate(candidate);
                  }}
                  className={cn(
                    'hover:bg-surface-container-high flex h-9 w-full items-center gap-2 rounded-md px-2 text-left',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  <span className="text-on-surface-variant shrink-0">
                    {kindIcon(candidate.subjectType)}
                  </span>
                  <Text token="body-medium" truncate className="min-w-0 flex-1">
                    {candidate.title}
                  </Text>
                  <Text token="label-small" tone="muted" className="shrink-0">
                    {KIND_LABEL[candidate.subjectType]}
                  </Text>
                </button>
              ))
            )}
          </div>

          {attachError ? (
            <Text as="p" token="body-small" tone="error" role="alert">
              {attachError}
            </Text>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            controlSize="lg"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
