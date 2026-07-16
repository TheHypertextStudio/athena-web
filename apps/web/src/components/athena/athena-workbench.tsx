'use client';

import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { type JSX, type SyntheticEvent, useMemo, useState } from 'react';

import { presentAthenaSession, type PersonalAthenaSessionDetail } from '@/lib/athena/presentation';
import type { PersonalAthenaLifecycle } from '@/lib/athena/query-defs';

/** Events emitted by the shared personal Athena workbench. */
export interface AthenaWorkbenchProps {
  readonly session: PersonalAthenaSessionDetail;
  readonly className?: string;
  readonly pending?: boolean;
  readonly onDecision?: (decisionId: string, optionId: string) => void;
  readonly onLifecycle?: (action: PersonalAthenaLifecycle) => void;
  readonly onMessage?: (body: string) => void;
}

/**
 * Render one piece of personal Athena work as an operations desk rather than a transcript.
 *
 * @remarks
 * The same component is hosted in the contextual dock, `/athena`, and personal deep links. Model
 * reasoning is removed by the pure presenter; tool identifiers and payloads stay collapsed under
 * an explicit technical disclosure.
 */
export function AthenaWorkbench({
  session,
  className,
  pending = false,
  onDecision,
  onLifecycle,
  onMessage,
}: AthenaWorkbenchProps): JSX.Element {
  const view = useMemo(() => presentAthenaSession(session), [session]);
  const decision = view.decision;
  const [draft, setDraft] = useState('');

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending) return;
    onMessage?.(body);
    setDraft('');
  }

  return (
    <article className={cn('bg-surface text-on-surface flex min-h-0 flex-1 flex-col', className)}>
      <header className="border-outline-variant flex flex-col gap-3 border-b px-4 py-4 @2xl:px-6">
        <div className="text-label-medium flex flex-wrap items-center gap-2">
          <span className="bg-primary-container text-on-primary-container rounded-full px-2.5 py-1 font-medium">
            {view.stateLabel}
          </span>
          {view.workspaceLabel ? (
            <span className="text-on-surface-variant">{view.workspaceLabel}</span>
          ) : null}
          {view.contextLabel ? (
            <span className="text-on-surface-variant before:mr-2 before:content-['/']">
              {view.contextLabel}
            </span>
          ) : null}
        </div>
        <h2 className="text-on-surface max-w-3xl text-xl leading-tight font-semibold tracking-[-0.015em] text-balance">
          {view.objective}
        </h2>
        <div className="flex min-h-10 flex-wrap items-center gap-2">
          {view.canPause ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={pending}
              onClick={() => onLifecycle?.('pause')}
            >
              Pause
            </Button>
          ) : null}
          {view.canResume ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={pending}
              onClick={() => onLifecycle?.('resume')}
            >
              Resume
            </Button>
          ) : null}
          {view.canCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-on-surface min-h-10"
              disabled={pending}
              onClick={() => onLifecycle?.('cancel')}
            >
              Cancel work
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {decision ? (
          <section
            aria-labelledby={`athena-decision-${decision.id}`}
            className="border-primary/30 bg-primary-container/25 border-b px-4 py-5 @2xl:px-6"
          >
            <div className="border-primary max-w-3xl border-l-2 pl-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id={`athena-decision-${decision.id}`}
                  className="text-on-surface text-base font-semibold"
                >
                  {decision.title}
                </h3>
                {decision.private ? (
                  <span className="text-on-surface-variant text-xs">
                    Only you can see this decision
                  </span>
                ) : null}
              </div>
              {decision.description ? (
                <p className="text-on-surface-variant mt-1 max-w-2xl text-sm leading-6">
                  {decision.description}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {decision.options.map((option, index) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={index === 0 ? 'default' : 'outline'}
                    className={cn('min-h-10', index > 0 && 'text-on-surface')}
                    disabled={pending}
                    onClick={() => onDecision?.(decision.id, option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section aria-label="Work log" className="px-4 py-2 @2xl:px-6">
          {view.activity.length === 0 ? (
            <p className="text-on-surface-variant py-8 text-sm">Athena is preparing the work.</p>
          ) : (
            <ol className="divide-outline-variant divide-y">
              {view.activity.map((entry) => (
                <li key={entry.id} className="grid gap-1 py-4 @2xl:grid-cols-[10rem_minmax(0,1fr)]">
                  <span className="text-on-surface-variant text-xs tabular-nums">
                    {new Intl.DateTimeFormat(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(entry.createdAt))}
                  </span>
                  <div className="min-w-0">
                    <p className="text-on-surface text-sm font-medium break-words">{entry.title}</p>
                    {entry.detail ? (
                      <p className="text-on-surface-variant mt-0.5 text-sm leading-6 break-words whitespace-pre-wrap">
                        {entry.detail}
                      </p>
                    ) : null}
                    {entry.technical ? (
                      <details className="text-on-surface-variant mt-2 text-xs">
                        <summary className="focus-visible:ring-ring min-h-10 w-fit cursor-pointer py-2 focus-visible:ring-2 focus-visible:outline-none">
                          Technical details
                        </summary>
                        <pre className="bg-surface-container-high mt-1 max-w-full overflow-x-auto rounded-md p-3 text-[0.7rem] leading-5">
                          {JSON.stringify(entry.technical, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {view.result ? (
          <section className="border-outline-variant bg-surface-container-low mx-4 mb-4 border px-4 py-4 @2xl:mx-6">
            <h3 className="text-on-surface font-semibold">{view.result.title}</h3>
            <p className="text-on-surface-variant mt-1 text-sm leading-6">{view.result.summary}</p>
            {view.result.receipt && view.result.receipt.length > 0 ? (
              <dl className="divide-outline-variant border-outline-variant mt-4 divide-y border-t">
                {view.result.receipt.map((item) => (
                  <div
                    key={`${item.label}-${item.value}`}
                    className="grid gap-1 py-2 text-sm sm:grid-cols-[10rem_1fr]"
                  >
                    <dt className="text-on-surface-variant">{item.label}</dt>
                    <dd className="text-on-surface break-words">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ) : null}
      </div>

      <form
        aria-label="Steer Athena"
        className="border-outline-variant bg-surface flex items-end gap-2 border-t p-3 @2xl:p-4"
        onSubmit={submit}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{view.commandLabel}</span>
          <textarea
            aria-label={view.commandLabel}
            value={draft}
            disabled={pending}
            rows={2}
            placeholder={`${view.commandLabel}…`}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            className="border-outline-variant bg-surface-container-low text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring min-h-12 w-full resize-none rounded-lg border px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 disabled:opacity-60"
          />
        </label>
        <Button type="submit" className="min-h-10" disabled={pending || draft.trim().length === 0}>
          Send
        </Button>
      </form>
    </article>
  );
}
