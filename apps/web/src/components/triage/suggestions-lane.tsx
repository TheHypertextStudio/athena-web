/**
 * The "Suggested by Athena" lane in triage — email-derived task proposals awaiting confirmation.
 *
 * @remarks
 * Each card shows the synthesized task (title + description + confidence + due date) with the
 * source-email preview (sender / subject / snippet), an expandable live thread view (fetched
 * on demand from the mail provider — bodies are never stored), and accept / edit-then-accept /
 * dismiss actions. Nothing here is a task yet: accepting materializes a real task (with the
 * email attached) and drops the card; editing first submits the changed fields as accept-time
 * overrides. Rendered above the unsorted-task queue so it's the same place you process
 * incoming work. See `docs/engineering/specs/email-to-task.md` §9.
 */
'use client';

import type { EmailSuggestionOut, SuggestionAcceptBody } from '@docket/types';
import { Sparkles } from '@docket/ui/icons';
import { Badge, Button, Card, CardContent, DecorativeIcon, Input } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useEmailSuggestionThread, useEmailSuggestions } from '@/lib/use-email-suggestions';

/** Props for {@link ConfidenceBadge}. */
interface ConfidenceBadgeProps {
  /** The funnel confidence score (0–100), when recorded. */
  confidence: number | null;
}

/** The funnel-confidence chip on a suggestion card. */
function ConfidenceBadge({ confidence }: ConfidenceBadgeProps): JSX.Element | null {
  if (confidence === null) return null;
  const tone =
    confidence >= 70 ? 'text-primary' : confidence >= 40 ? 'text-on-surface-variant' : 'opacity-60';
  return (
    <Badge variant="outline" className={`shrink-0 tabular-nums ${tone}`}>
      {confidence}% match
    </Badge>
  );
}

/** Props for {@link EmailPreview}. */
interface EmailPreviewProps {
  /** The stored ingest-time snapshot of the source email. */
  meta: NonNullable<EmailSuggestionOut['emailMeta']>;
}

/** The source-email preview line(s) on a suggestion card. */
function EmailPreview({ meta }: EmailPreviewProps): JSX.Element {
  return (
    <div className="border-outline-variant text-muted-foreground rounded-md border border-dashed px-2 py-1 text-xs">
      {meta.sender ? <span className="font-medium">{meta.sender}</span> : null}
      {meta.subject ? <span> — {meta.subject}</span> : null}
      {meta.snippet ? <p className="line-clamp-2 opacity-80">{meta.snippet}</p> : null}
    </div>
  );
}

/** Props for {@link ThreadPreview}. */
interface ThreadPreviewProps {
  orgId: string;
  suggestionId: string;
  /** Only fetch while expanded — every fetch is a live provider round-trip. */
  expanded: boolean;
}

/** The expandable live source-thread view (read-on-demand; never persisted). */
function ThreadPreview({ orgId, suggestionId, expanded }: ThreadPreviewProps): JSX.Element | null {
  const { thread, isPending, error } = useEmailSuggestionThread(orgId, suggestionId, expanded);
  if (!expanded) return null;
  if (isPending) {
    return <p className="text-muted-foreground text-xs">Loading thread…</p>;
  }
  if (error !== null) {
    return <p className="text-destructive text-xs">{error}</p>;
  }
  if (!thread) return null;
  return (
    <div className="border-outline-variant flex flex-col gap-2 rounded-md border px-2 py-2">
      {thread.messages.map((m) => (
        <div key={m.id} className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">{m.from}</span>
          <span className="text-muted-foreground">{m.snippet}</span>
        </div>
      ))}
      <a
        href={thread.externalUrl}
        target="_blank"
        rel="noreferrer"
        className="text-primary w-fit font-medium hover:underline"
      >
        Open email
      </a>
    </div>
  );
}

/** Props for {@link SuggestionEditor}. */
interface SuggestionEditorProps {
  suggestion: EmailSuggestionOut;
  onAccept: (overrides: SuggestionAcceptBody) => void;
  onCancel: () => void;
}

/** Inline edit-then-accept: tweak title/description/due date, then accept the diff. */
function SuggestionEditor({ suggestion, onAccept, onCancel }: SuggestionEditorProps): JSX.Element {
  const [title, setTitle] = useState(suggestion.title);
  const [description, setDescription] = useState(suggestion.description ?? '');
  const [dueDate, setDueDate] = useState(suggestion.dueDate?.slice(0, 10) ?? '');

  // Only fields the user actually changed ride along as overrides.
  const overrides = (): SuggestionAcceptBody => ({
    ...(title !== suggestion.title && title.trim().length > 0 ? { title: title.trim() } : {}),
    ...(description !== (suggestion.description ?? '') ? { description } : {}),
    ...(dueDate !== (suggestion.dueDate?.slice(0, 10) ?? '') && dueDate !== ''
      ? { dueDate: new Date(`${dueDate}T00:00:00.000Z`).toISOString() }
      : {}),
  });

  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label="Task title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <Input
        aria-label="Task description"
        value={description}
        placeholder="Description"
        onChange={(e) => {
          setDescription(e.target.value);
        }}
      />
      <Input
        aria-label="Due date"
        type="date"
        value={dueDate}
        onChange={(e) => {
          setDueDate(e.target.value);
        }}
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          onClick={() => {
            onAccept(overrides());
          }}
        >
          Accept edits
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Props for {@link SuggestionCard}. */
interface SuggestionCardProps {
  orgId: string;
  suggestion: EmailSuggestionOut;
  /** Whether the viewer may accept/dismiss (`contribute`). */
  canAct: boolean;
  onAccept: (overrides: SuggestionAcceptBody) => void;
  onDismiss: () => void;
}

/** One suggestion card: synthesized task + email preview + expand/edit/accept/dismiss. */
function SuggestionCard({
  orgId,
  suggestion,
  canAct,
  onAccept,
  onDismiss,
}: SuggestionCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const meta = suggestion.emailMeta;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{suggestion.title}</span>
              <ConfidenceBadge confidence={suggestion.confidence} />
            </div>
            {suggestion.description ? (
              <span className="text-muted-foreground line-clamp-2 text-xs">
                {suggestion.description}
              </span>
            ) : null}
            {suggestion.dueDate ? (
              <span className="text-muted-foreground text-xs">
                Due {suggestion.dueDate.slice(0, 10)}
              </span>
            ) : null}
          </div>
          {canAct && !editing ? (
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                onClick={() => {
                  onAccept({});
                }}
              >
                Accept
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </div>

        {editing ? (
          <SuggestionEditor
            suggestion={suggestion}
            onAccept={(overrides) => {
              setEditing(false);
              onAccept(overrides);
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        ) : null}

        {meta !== null && (meta.sender || meta.subject) ? <EmailPreview meta={meta} /> : null}

        <button
          type="button"
          className="text-primary w-fit text-xs font-medium hover:underline"
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          {expanded ? 'Hide thread' : 'Show thread'}
        </button>
        <ThreadPreview orgId={orgId} suggestionId={suggestion.id} expanded={expanded} />
      </CardContent>
    </Card>
  );
}

/** Props for {@link SuggestionsLane}. */
interface SuggestionsLaneProps {
  /** The active organization id. */
  orgId: string;
  /** Whether the viewer may accept/dismiss (`contribute`). */
  canAct: boolean;
}

/** The Athena suggestions lane. */
export default function SuggestionsLane({
  orgId,
  canAct,
}: SuggestionsLaneProps): JSX.Element | null {
  const { suggestions, accept, dismiss, actionError } = useEmailSuggestions(orgId);

  // The lane is absent (not an empty box) when Athena has proposed nothing.
  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-heading" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <DecorativeIcon icon={Sparkles} />
        <h2 id="suggestions-heading" className="text-sm font-semibold">
          Suggested by Athena
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">{suggestions.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <SuggestionCard
            key={s.id}
            orgId={orgId}
            suggestion={s}
            canAct={canAct}
            onAccept={(overrides) => void accept({ id: s.id, overrides })}
            onDismiss={() => void dismiss(s.id)}
          />
        ))}
      </div>
      {actionError ? <p className="text-destructive text-xs">{actionError}</p> : null}
    </section>
  );
}
