'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateChoice, WorkTemplateDisplay } from '@docket/work/work-template-reference';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { ChevronDown } from '@docket/ui/icons';
import { type JSX, useState, useRef } from 'react';
import { useInfiniteApiQuery } from '@/lib/query';
import { workTemplateGlyph } from '@/components/work-views/work-template-label';
import { workTemplateChoicesDef } from './work-template-identity-queries';

/** Compact shared name, glyph and pinned version for editors and publication-only readers. */
export function WorkTemplateIdentityLabel({
  kind,
  current,
}: {
  readonly kind: TemplateTargetType;
  readonly current: WorkTemplateDisplay;
}): JSX.Element {
  return (
    <>
      {workTemplateGlyph(kind, current.icon)}
      <span className="truncate">{current.name}</span>
      <span className="text-on-surface-variant shrink-0">
        Version {current.versionNumber}
        {current.archived ? ' · Archived' : ''}
      </span>
    </>
  );
}

interface ChoiceMenuProps {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly teamId: string | null;
  readonly current: WorkTemplateDisplay;
  readonly versionId: string | undefined;
  readonly onSelect: (choice: WorkTemplateChoice) => void;
  readonly canChange?: boolean;
  readonly onUpdate?: (() => void) | undefined;
  readonly onCapture?: (() => void) | undefined;
}

function TemplateActions({
  props,
  onChange,
  queue,
}: {
  readonly props: ChoiceMenuProps;
  readonly onChange: () => void;
  readonly queue: (action: () => void) => void;
}): JSX.Element {
  return (
    <>
      {props.onUpdate ? (
        <DropdownMenuItem
          onSelect={() => {
            if (props.onUpdate) queue(props.onUpdate);
          }}
        >
          Update template
        </DropdownMenuItem>
      ) : null}
      {props.canChange !== false ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onChange();
          }}
        >
          Change template
        </DropdownMenuItem>
      ) : null}
      {props.onCapture ? (
        <DropdownMenuItem
          onSelect={() => {
            if (props.onCapture) queue(props.onCapture);
          }}
        >
          Save as template
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function TemplateChoices({
  props,
  onBack,
  queue,
}: {
  readonly props: ChoiceMenuProps;
  readonly onBack: () => void;
  readonly queue: (action: () => void) => void;
}): JSX.Element {
  const choices = useInfiniteApiQuery(
    workTemplateChoicesDef(props.orgId, props.kind, props.teamId, true),
  );
  const items = choices.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        Back to template actions
      </DropdownMenuItem>
      <DropdownMenuLabel className="text-body-small whitespace-normal">
        Choose a template to review before changing this work.
      </DropdownMenuLabel>
      {choices.isError && !items.length ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void choices.refetch();
          }}
        >
          Templates unavailable · Retry
        </DropdownMenuItem>
      ) : choices.isPending ? (
        <DropdownMenuItem disabled>Loading templates…</DropdownMenuItem>
      ) : (
        <TemplateChoiceItems props={props} items={items} queue={queue} />
      )}
      {choices.hasNextPage ? (
        <DropdownMenuItem
          disabled={choices.isFetchingNextPage}
          onSelect={(event) => {
            event.preventDefault();
            void choices.fetchNextPage();
          }}
        >
          {choices.isError
            ? 'More templates unavailable · Retry'
            : choices.isFetchingNextPage
              ? 'Loading…'
              : 'More templates…'}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function TemplateChoiceItems({
  props,
  items,
  queue,
}: {
  readonly props: ChoiceMenuProps;
  readonly items: readonly WorkTemplateChoice[];
  readonly queue: (action: () => void) => void;
}): JSX.Element {
  const isCurrent = (choice: WorkTemplateChoice): boolean =>
    choice.id === props.current.id && choice.versionId === props.versionId;
  return (
    <>
      {items.some(isCurrent) ? null : (
        <DropdownMenuItem disabled>
          Current template: {props.current.name} · Version {props.current.versionNumber}
        </DropdownMenuItem>
      )}
      {items.map((choice) => (
        <DropdownMenuItem
          key={choice.id}
          disabled={isCurrent(choice)}
          onSelect={() => {
            queue(() => {
              props.onSelect(choice);
            });
          }}
        >
          {workTemplateGlyph(props.kind, choice.icon)}
          {choice.name} · Version {choice.versionNumber}
          {isCurrent(choice) ? ' · Current template' : ''}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Keep identity visible and disclose change, update and capture actions in one contextual menu. */
export function WorkTemplateChoiceMenu(props: ChoiceMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'actions' | 'choices'>('actions');
  const queued = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const queue = (action: () => void): void => {
    queued.current = action;
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-label-medium inline-flex max-w-full min-w-0 items-center gap-1.5">
        <WorkTemplateIdentityLabel kind={props.kind} current={props.current} />
      </span>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setView('actions');
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Template actions"
            className="max-w-full"
          >
            Template actions
            <ChevronDown className="size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          width="lg"
          onCloseAutoFocus={(event) => {
            const action = queued.current;
            if (action) {
              event.preventDefault();
              queued.current = null;
              // Give the dialog a real focus origin before the menu releases its focus scope.
              trigger.current?.focus({ preventScroll: true });
              requestAnimationFrame(action);
            }
          }}
        >
          {view === 'actions' ? (
            <TemplateActions
              props={props}
              onChange={() => {
                setView('choices');
              }}
              queue={queue}
            />
          ) : (
            <TemplateChoices
              props={props}
              onBack={() => {
                setView('actions');
              }}
              queue={queue}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
