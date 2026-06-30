/**
 * The "Suggested by Athena" lane in triage — email-derived task proposals awaiting confirmation.
 *
 * @remarks
 * Each card shows the synthesized task (title + description) with the source email preview
 * (sender / subject / snippet) and accept / dismiss actions. Nothing here is a task yet:
 * accepting materializes a real task (with the email attached) and drops the card; dismissing
 * discards it. Rendered above the unsorted-task queue so it's the same place you process
 * incoming work. See `docs/engineering/specs/email-to-task.md` §9.
 */
'use client';

import type { EmailSuggestionOut } from '@docket/types';
import { Sparkles } from '@docket/ui/icons';
import { Button, Card, CardContent } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useEmailSuggestions } from '@/lib/use-email-suggestions';

/** The source-email preview line(s) on a suggestion card. */
function EmailPreview({
  meta,
}: {
  meta: NonNullable<EmailSuggestionOut['emailMeta']>;
}): JSX.Element {
  return (
    <div className="border-outline-variant text-muted-foreground rounded-md border border-dashed px-2 py-1 text-xs">
      {meta.sender ? <span className="font-medium">{meta.sender}</span> : null}
      {meta.subject ? <span> — {meta.subject}</span> : null}
      {meta.snippet ? <p className="line-clamp-2 opacity-80">{meta.snippet}</p> : null}
    </div>
  );
}

/** One suggestion card: synthesized task + source-email preview + accept/dismiss. */
function SuggestionCard({
  suggestion,
  canAct,
  onAccept,
  onDismiss,
}: {
  suggestion: EmailSuggestionOut;
  canAct: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const meta = suggestion.emailMeta;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{suggestion.title}</span>
            {suggestion.description ? (
              <span className="text-muted-foreground line-clamp-2 text-xs">
                {suggestion.description}
              </span>
            ) : null}
          </div>
          {canAct ? (
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" onClick={onAccept}>
                Accept
              </Button>
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </div>
        {meta !== null && (meta.sender || meta.subject) ? <EmailPreview meta={meta} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * The Athena suggestions lane.
 *
 * @param orgId - The active organization id.
 * @param canAct - Whether the viewer may accept/dismiss (`contribute`).
 */
export default function SuggestionsLane({
  orgId,
  canAct,
}: {
  orgId: string;
  canAct: boolean;
}): JSX.Element | null {
  const { suggestions, accept, dismiss, actionError } = useEmailSuggestions(orgId);

  // The lane is absent (not an empty box) when Athena has proposed nothing.
  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-heading" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 opacity-70" aria-hidden="true" />
        <h2 id="suggestions-heading" className="text-sm font-semibold">
          Suggested by Athena
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">{suggestions.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            canAct={canAct}
            onAccept={() => void accept(s.id)}
            onDismiss={() => void dismiss(s.id)}
          />
        ))}
      </div>
      {actionError ? <p className="text-destructive text-xs">{actionError}</p> : null}
    </section>
  );
}
