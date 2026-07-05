'use client';

/**
 * `calendar/create-block-form` — the full calendar view's "create a native block" action.
 *
 * @remarks
 * A small popover form over {@link useCreateNativeBlock}. The caller supplies the range-list
 * query keys currently on screen (`rangeKeys`) so the mutation's settle-time invalidation refetches
 * exactly the windows the new block might land in, per `calendar-mutations.ts`'s invalidate-only
 * contract for server-assigned-identity inserts.
 */
import { Plus } from '@docket/ui/icons';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import { type JSX, type SubmitEventHandler, useState } from 'react';

import { useCreateNativeBlock } from './calendar-mutations';
import { fromLocalInputValue, toLocalInputValue } from './datetime-input';

/** A round-to-the-half-hour default start, so the form opens with a sensible timed window. */
function defaultStart(): Date {
  const now = new Date();
  now.setMinutes(now.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (now.getMinutes() === 0) now.setHours(now.getHours() + 1);
  return now;
}

/** Props for {@link CreateBlockForm}. */
export interface CreateBlockFormProps {
  /** The range-list query keys currently on screen, invalidated once the block is created. */
  rangeKeys: readonly QueryKey[];
}

/** The create-native-block popover trigger + form. */
export default function CreateBlockForm({ rangeKeys }: CreateBlockFormProps): JSX.Element {
  const create = useCreateNativeBlock();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const start = defaultStart();
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(start.toISOString()));
  const [endsAt, setEndsAt] = useState(() =>
    toLocalInputValue(new Date(start.getTime() + 30 * 60_000).toISOString()),
  );

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      {
        input: {
          kind: 'native_block',
          title: trimmed,
          startsAt: fromLocalInputValue(startsAt),
          endsAt: fromLocalInputValue(endsAt),
        },
        rangeKeys,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setTitle('');
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> New block
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            <span className="text-on-surface-variant">Title</span>
            <Input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              placeholder="Focus block"
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span className="text-on-surface-variant">Starts</span>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span className="text-on-surface-variant">Ends</span>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(event.target.value);
                }}
              />
            </label>
          </div>
          <Button type="submit" size="sm" disabled={title.trim().length === 0 || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create block'}
          </Button>
          {create.isError ? (
            <p className="text-destructive text-xs">{create.error.message}</p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
