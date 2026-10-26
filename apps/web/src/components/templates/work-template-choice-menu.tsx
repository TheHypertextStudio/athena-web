'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateChoice, WorkTemplateDisplay } from '@docket/work/work-template-reference';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { ChevronDown, Ellipsis } from '@docket/ui/icons';
import { type JSX, type ReactNode, type RefObject, useState, useRef } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import { WorkTypeDefinitionDetails } from './work-type-definition-details';
import { workTypeDisplayName } from './work-type-name';
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

/** Placement of template provenance and actions within a detail surface. */
export interface WorkTemplatePresentationProps {
  readonly presentation?: 'inline' | 'menu' | undefined;
  readonly menuLabel?: string | undefined;
  readonly menuItems?: ReactNode;
}

interface ChoiceMenuProps extends WorkTemplatePresentationProps {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly teamId: string | null;
  readonly current: WorkTemplateDisplay | undefined;
  readonly loading?: boolean | undefined;
  readonly onRetry?: (() => void) | undefined;
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
          {props.presentation === 'menu' ? 'Change work type' : 'Change template'}
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
        {props.presentation === 'menu' ? 'Back to work type actions' : 'Back to template actions'}
      </DropdownMenuItem>
      <DropdownMenuLabel className="text-body-small whitespace-normal">
        {props.presentation === 'menu'
          ? 'Choose a work type to review before changing this work.'
          : 'Choose a template to review before changing this work.'}
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
  const familyName = useVocabulary(props.kind);
  const isCurrent = (choice: WorkTemplateChoice): boolean =>
    choice.id === props.current?.id && choice.versionId === props.versionId;
  return (
    <>
      {items.some(isCurrent) ? null : (
        <DropdownMenuItem disabled>
          {props.presentation === 'menu'
            ? `Current work type: ${props.current ? workTypeDisplayName(props.current, familyName) : familyName}`
            : `Current template: ${props.current?.name} · Version ${props.current?.versionNumber}`}
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
          {props.presentation === 'menu'
            ? workTypeDisplayName(choice, familyName)
            : `${choice.name} · Version ${choice.versionNumber}`}
          {isCurrent(choice)
            ? props.presentation === 'menu'
              ? ' · Current'
              : ' · Current template'
            : ''}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function TemplateMenuActions({
  props,
  onChange,
  queue,
  onDetails,
}: {
  readonly onDetails: () => void;
  readonly props: ChoiceMenuProps;
  readonly onChange: () => void;
  readonly queue: (action: () => void) => void;
}): JSX.Element {
  const familyName = useVocabulary(props.kind);
  return (
    <>
      {props.presentation === 'menu' && props.current ? (
        <DropdownMenuLabel className="flex min-w-0 items-center gap-1.5">
          Work type · <span>{workTypeDisplayName(props.current, familyName)}</span>
        </DropdownMenuLabel>
      ) : null}
      {props.current ? (
        props.presentation === 'menu' ? (
          <>
            {props.canChange !== false ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onChange();
                }}
              >
                Change work type
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={() => {
                queue(onDetails);
              }}
            >
              Type definition details
            </DropdownMenuItem>
          </>
        ) : (
          <TemplateActions props={props} onChange={onChange} queue={queue} />
        )
      ) : (
        <>
          <DropdownMenuItem
            disabled={props.loading === true}
            onSelect={(event) => {
              event.preventDefault();
              props.onRetry?.();
            }}
          >
            {props.loading ? 'Loading template…' : 'Template unavailable · Retry'}
          </DropdownMenuItem>
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
      )}
      {props.menuItems ? (
        <>
          <DropdownMenuSeparator />
          {props.menuItems}
        </>
      ) : null}
    </>
  );
}

/** Menu and dialog handoffs share one focus origin and never unmount their controller. */
function useTemplateMenuState() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'actions' | 'choices'>('actions');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const queued = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const queue = (action: () => void): void => {
    queued.current = action;
  };
  const afterClose = (event: Event): void => {
    const action = queued.current;
    if (!action) return;
    event.preventDefault();
    queued.current = null;
    trigger.current?.focus({ preventScroll: true });
    requestAnimationFrame(action);
  };
  const fromDetails = (action: (() => void) | undefined): (() => void) | undefined =>
    action
      ? () => {
          queue(action);
          setDetailsOpen(false);
        }
      : undefined;
  return {
    open,
    setOpen,
    view,
    setView,
    detailsOpen,
    setDetailsOpen,
    trigger,
    queue,
    afterClose,
    fromDetails,
  };
}

/** Return the real button so the shared menu can attach its native trigger behavior. */
function templateMenuTrigger(
  props: ChoiceMenuProps,
  trigger: RefObject<HTMLButtonElement | null>,
): JSX.Element {
  return (
    <Button
      ref={trigger}
      type="button"
      variant="ghost"
      size="sm"
      aria-label={props.menuLabel ?? 'Template actions'}
      iconOnly={props.presentation === 'menu'}
      className="max-w-full"
    >
      {props.presentation === 'menu' ? (
        <Ellipsis />
      ) : (
        <>
          Template actions
          <ChevronDown className="size-4 shrink-0" />
        </>
      )}
    </Button>
  );
}

/** Keep work identity separate from deliberately opened definition and authoring details. */
export function WorkTemplateChoiceMenu(props: ChoiceMenuProps): JSX.Element {
  const state = useTemplateMenuState();
  const familyName = useVocabulary(props.kind);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {props.presentation !== 'menu' && props.current ? (
        <span className="text-label-medium inline-flex max-w-full min-w-0 items-center gap-1.5">
          <WorkTemplateIdentityLabel kind={props.kind} current={props.current} />
        </span>
      ) : null}
      <DropdownMenu
        open={state.open}
        onOpenChange={(next) => {
          state.setOpen(next);
          if (!next) state.setView('actions');
        }}
      >
        <DropdownMenuTrigger asChild>
          {templateMenuTrigger(props, state.trigger)}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={props.presentation === 'menu' ? 'end' : 'start'}
          width="lg"
          onCloseAutoFocus={state.afterClose}
        >
          {state.view === 'actions' ? (
            <TemplateMenuActions
              props={props}
              onChange={() => {
                state.setView('choices');
              }}
              queue={state.queue}
              onDetails={() => {
                state.setDetailsOpen(true);
              }}
            />
          ) : (
            <TemplateChoices
              props={props}
              onBack={() => {
                state.setView('actions');
              }}
              queue={state.queue}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <WorkTypeDefinitionDetails
        current={props.current}
        familyName={familyName}
        open={state.detailsOpen}
        onOpenChange={state.setDetailsOpen}
        onCloseAutoFocus={state.afterClose}
        onUpdate={state.fromDetails(props.onUpdate)}
        onCapture={state.fromDetails(props.onCapture)}
      />
    </div>
  );
}
