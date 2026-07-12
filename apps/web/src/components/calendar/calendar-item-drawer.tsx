'use client';

/**
 * `calendar/calendar-item-drawer` — the item workspace: the primary detail interaction for one
 * layered-calendar item.
 *
 * @remarks
 * Composed over `@docket/ui`'s `Sheet` (Radix `Dialog` underneath: focus trap, `Escape`-to-close,
 * scroll-lock, return-focus-to-opener) rather than hand-rolled markup — see
 * `docs/engineering/specs/calendar-ui.md`'s workspace section. Sections, top to bottom: header
 * (title/time/layer/source badge/provider link), sync status (clean/pending/conflict/failed, plus
 * the read-only reason when the viewer can't edit), core fields (an inline form, disabled with a
 * visible reason when `!permissions.canEditCore`), linked tasks grouped by role with
 * create/link/detach/open actions, and a compact provider-metadata line. The whole body remounts
 * (via a `key={item.id}` on {@link CalendarItemWorkspace}) whenever the shown item changes, so
 * every section's local form state resets for free instead of needing a sync effect.
 *
 * Detach/delete mirror this codebase's one existing two-step destructive-action pattern
 * (`DisconnectConfirmDialog`'s `Dialog` confirm) rather than inventing a new one. Every internal
 * section component below takes a named `XProps` interface, mirroring `agenda-canvas.tsx`'s
 * convention of naming even file-private component props.
 */
import type {
  CalendarItemLinkedTaskOut,
  CalendarItemOut,
  CalendarItemTaskRole,
  CalendarLayerOut,
} from '@docket/types';
import { OrganizationId, TaskId } from '@docket/types';
import { Link as LinkIcon, Plus, Trash2 } from '@docket/ui/icons';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type SubmitEventHandler, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { shiftISODate } from '@/components/agenda/agenda-context';
import { formatCalendarDate } from '@/lib/format-date';
import { useApiListQuery, useApiQuery } from '@/lib/query';

import {
  CALENDAR_ITEM_KIND_ICON,
  CALENDAR_ITEM_KIND_LABEL,
  READ_ONLY_REASON_LABEL,
  SYNC_STATE_META,
} from './calendar-item-card';
import { calendarItemDef, calendarLayersDef } from './calendar-data';
import { fromLocalInputValue, toLocalInputValue } from './datetime-input';
import {
  useCreateAndLinkTask,
  useDeleteCalendarItem,
  useDetachTaskFromItem,
  useLinkTaskToItem,
  useRetryCalendarItemWrite,
  useUpdateCalendarItem,
} from './calendar-mutations';
import { userErrorMessage } from '@/lib/problem';

/** Display labels for {@link CalendarItemTaskRole}, in the order the task stack groups them. */
const ROLE_ORDER: readonly CalendarItemTaskRole[] = [
  'prep',
  'agenda',
  'follow_up',
  'outcome',
  'related',
];
const ROLE_LABEL: Record<CalendarItemTaskRole, string> = {
  prep: 'Prep',
  agenda: 'Agenda',
  follow_up: 'Follow-up',
  outcome: 'Outcome',
  related: 'Related',
};

/** Local clock label, e.g. `9:30 AM`. */
function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A human time-range label for the header, covering the timed and all-day shapes. */
function itemTimeLabel(item: CalendarItemOut): string {
  if (item.startsAt && item.endsAt) {
    const sameDay = new Date(item.startsAt).toDateString() === new Date(item.endsAt).toDateString();
    const day = formatCalendarDate(item.startsAt) ?? '';
    return sameDay
      ? `${day} · ${formatClock(item.startsAt)} – ${formatClock(item.endsAt)}`
      : `${formatClock(item.startsAt)} (${day}) – ${formatClock(item.endsAt)} (${formatCalendarDate(item.endsAt) ?? ''})`;
  }
  if (item.allDayStartDate && item.allDayEndDate) {
    return `All day · ${formatCalendarDate(item.allDayStartDate) ?? item.allDayStartDate}`;
  }
  return 'No time set';
}

/** Shared classes for a small destructive confirm button inside a `DialogFooter`. */
const DESTRUCTIVE_CONFIRM_CLASS =
  'focus-visible:ring-ring bg-destructive text-destructive-foreground hover:bg-destructive/90 text-body rounded-md px-3 py-1.5 font-medium shadow-sm transition-colors outline-none focus-visible:ring-1';
/** Shared classes for the `Cancel` action inside a `DialogFooter`. */
const CANCEL_CLASS =
  'focus-visible:ring-ring text-on-surface-variant hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1';

/** Props for {@link SyncStatusSection}. */
interface SyncStatusSectionProps {
  /** The calendar item whose sync status to render. */
  item: CalendarItemOut;
}

/** The sync-status section: a conflict banner, or the current sync/read-only state, compactly. */
function SyncStatusSection({ item }: SyncStatusSectionProps): JSX.Element {
  const retry = useRetryCalendarItemWrite(item.id);
  const readOnlyLabel = item.permissions.readOnlyReason
    ? READ_ONLY_REASON_LABEL[item.permissions.readOnlyReason]
    : null;

  if (item.hasConflict) {
    return (
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/10 flex flex-col gap-2 rounded-lg border p-3"
      >
        <p className="text-destructive text-sm font-medium">Sync conflict</p>
        <p className="text-on-surface-variant text-xs">
          Local changes and the provider diverged. Open the item in the provider to review, or retry
          pushing your local changes.
        </p>
        <div className="flex flex-wrap gap-2">
          {item.htmlLink ? (
            <Button asChild size="sm" variant="outline">
              <a href={item.htmlLink} target="_blank" rel="noreferrer">
                Open in provider
              </a>
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => {
              retry.mutate(undefined);
            }}
            disabled={retry.isPending}
          >
            {retry.isPending ? 'Retrying…' : 'Retry with local changes'}
          </Button>
        </div>
        {retry.isError ? (
          <p className="text-destructive text-xs">
            {userErrorMessage(retry.error, 'Could not update the calendar item.')}
          </p>
        ) : null}
      </div>
    );
  }

  const meta = SYNC_STATE_META[item.syncState];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {meta ? (
        <span
          className={cn(
            'flex items-center gap-1.5',
            item.syncState === 'provider_error' ? 'text-destructive' : 'text-on-surface-variant',
          )}
        >
          <meta.icon
            className={cn('size-3.5', item.syncState === 'push_pending' && 'animate-spin')}
          />
          {meta.label}
        </span>
      ) : (
        <span className="text-on-surface-variant">Synced</span>
      )}
      {readOnlyLabel ? <span className="text-on-surface-variant">· {readOnlyLabel}</span> : null}
      {item.syncState === 'provider_error' ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            retry.mutate(undefined);
          }}
          disabled={retry.isPending}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** The `datetime-local` seed value for a timed bound, or `''` for an untimed item. */
function localInputSeed(iso: string | null): string {
  return iso ? toLocalInputValue(iso) : '';
}

/**
 * The `date` input seed value for an all-day *end* bound, or `''` if unset.
 *
 * @remarks
 * `allDayEndDate` is stored exclusive (the day *after* the last included day), but a `date` input
 * should show the last included day, so this shifts back one day for display;
 * {@link fromAllDayEndSeed} reverses the shift before writing.
 */
function localAllDayEndSeed(date: string | null): string {
  return date ? shiftISODate(date, -1) : '';
}

/** Convert a displayed (inclusive) all-day end date back to the wire's exclusive end date. */
function fromAllDayEndSeed(date: string): string {
  return shiftISODate(date, 1);
}

/** Props for {@link CoreFieldsForm}. */
interface CoreFieldsFormProps {
  /** The calendar item whose core fields the form edits. */
  item: CalendarItemOut;
}

/** The inline core-fields form: title/description/location/time, disabled when not editable. */
function CoreFieldsForm({ item }: CoreFieldsFormProps): JSX.Element {
  const update = useUpdateCalendarItem(item.id);
  const canEdit = item.permissions.canEditCore;
  const timed = item.startsAt !== null;

  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [location, setLocation] = useState(item.location ?? '');
  const [startsAt, setStartsAt] = useState(localInputSeed(item.startsAt));
  const [endsAt, setEndsAt] = useState(localInputSeed(item.endsAt));
  const [allDayStart, setAllDayStart] = useState(item.allDayStartDate ?? '');
  const [allDayEnd, setAllDayEnd] = useState(localAllDayEndSeed(item.allDayEndDate));

  const dirty =
    title !== item.title ||
    description !== (item.description ?? '') ||
    location !== (item.location ?? '') ||
    (timed
      ? startsAt !== localInputSeed(item.startsAt) || endsAt !== localInputSeed(item.endsAt)
      : allDayStart !== (item.allDayStartDate ?? '') ||
        allDayEnd !== localAllDayEndSeed(item.allDayEndDate));

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!canEdit || !dirty || title.trim().length === 0) return;
    if (!timed && (allDayStart.length === 0 || allDayEnd.length === 0)) return;
    update.mutate({
      title,
      description,
      location,
      ...(timed
        ? { startsAt: fromLocalInputValue(startsAt), endsAt: fromLocalInputValue(endsAt) }
        : { allDayStartDate: allDayStart, allDayEndDate: fromAllDayEndSeed(allDayEnd) }),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Title</span>
        <Input
          value={title}
          disabled={!canEdit}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Description</span>
        <textarea
          value={description}
          disabled={!canEdit}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          rows={3}
          className="border-outline-variant text-body flex w-full resize-none rounded-md border bg-transparent px-3 py-2 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Location</span>
        <Input
          value={location}
          disabled={!canEdit}
          onChange={(event) => {
            setLocation(event.target.value);
          }}
        />
      </label>
      {timed ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            <span className="text-on-surface-variant">Starts</span>
            <Input
              type="datetime-local"
              value={startsAt}
              disabled={!canEdit}
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
              disabled={!canEdit}
              onChange={(event) => {
                setEndsAt(event.target.value);
              }}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            <span className="text-on-surface-variant">Starts</span>
            <Input
              type="date"
              value={allDayStart}
              disabled={!canEdit}
              onChange={(event) => {
                setAllDayStart(event.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            <span className="text-on-surface-variant">Ends</span>
            <Input
              type="date"
              value={allDayEnd}
              disabled={!canEdit}
              onChange={(event) => {
                setAllDayEnd(event.target.value);
              }}
            />
          </label>
        </div>
      )}
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {update.isError ? (
            <p role="alert" className="text-destructive text-xs">
              {userErrorMessage(update.error, 'Could not update the calendar item.')}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

/** Props for {@link LinkedTaskRow}. */
interface LinkedTaskRowProps {
  /** The owning calendar item's id. */
  itemId: string;
  /** The linked-task summary to render. */
  link: CalendarItemLinkedTaskOut;
  /** Navigate to the linked task's detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
}

/** One linked-task row: open the task, or detach it (behind a confirm dialog). */
function LinkedTaskRow({ itemId, link, onOpenTask }: LinkedTaskRowProps): JSX.Element {
  const detach = useDetachTaskFromItem(itemId, link.taskId);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => {
          onOpenTask(link.organizationId, link.taskId);
        }}
        className={cn(
          'focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm text-left text-sm focus-visible:ring-2 focus-visible:outline-none',
          link.done ? 'text-on-surface-variant line-through' : 'text-on-surface',
        )}
      >
        {link.title}
      </button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Detach ${link.title}`}
        onClick={() => {
          setConfirming(true);
        }}
        disabled={detach.isPending}
      >
        Detach
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>Detach &ldquo;{link.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              The task stays as-is; only its link to this calendar item is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className={CANCEL_CLASS}>Cancel</DialogClose>
            <button
              type="button"
              className={DESTRUCTIVE_CONFIRM_CLASS}
              onClick={() => {
                detach.mutate(undefined);
                setConfirming(false);
              }}
            >
              Detach
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Props for {@link CreateTaskForm}. */
interface CreateTaskFormProps {
  /** The owning calendar item's id. */
  itemId: string;
  /** Placeholder shown in the title field — the item's own title. */
  fallbackTitle: string;
  /** Called once the task is created and linked. */
  onDone: () => void;
}

/** The "create a new task and link it" form. */
function CreateTaskForm({ itemId, fallbackTitle, onDone }: CreateTaskFormProps): JSX.Element {
  const { orgs } = useActiveOrg();
  const create = useCreateAndLinkTask(itemId);
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id ?? null);
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<CalendarItemTaskRole>('related');

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!organizationId) return;
    create.mutate(
      { organizationId, title: title.trim() || undefined, role },
      { onSuccess: onDone },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="border-outline-variant flex flex-col gap-2 rounded-md border p-3"
    >
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Organization</span>
        <select
          value={organizationId ?? ''}
          onChange={(event) => {
            setOrganizationId(OrganizationId.parse(event.target.value));
          }}
          className="border-outline-variant text-body rounded-md border bg-transparent px-2 py-1.5"
        >
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Title (optional)</span>
        <Input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          placeholder={fallbackTitle}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Role</span>
        <select
          value={role}
          onChange={(event) => {
            setRole(event.target.value as CalendarItemTaskRole);
          }}
          className="border-outline-variant text-body rounded-md border bg-transparent px-2 py-1.5"
        >
          {ROLE_ORDER.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABEL[option]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!organizationId || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create & link'}
        </Button>
      </div>
      {create.isError ? (
        <p className="text-destructive text-xs">
          {userErrorMessage(create.error, 'Could not update the calendar item.')}
        </p>
      ) : null}
    </form>
  );
}

/** Props for {@link LinkTaskForm}. */
interface LinkTaskFormProps {
  /** The owning calendar item's id. */
  itemId: string;
  /** Called once the existing task is linked. */
  onDone: () => void;
}

/** The "link an existing task" form (by org + task id). */
function LinkTaskForm({ itemId, onDone }: LinkTaskFormProps): JSX.Element {
  const { orgs } = useActiveOrg();
  const link = useLinkTaskToItem(itemId);
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id ?? null);
  const [taskIdInput, setTaskIdInput] = useState('');
  const parsedTaskId = TaskId.safeParse(taskIdInput.trim());

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!organizationId || !parsedTaskId.success) return;
    link.mutate(
      { organizationId, taskId: parsedTaskId.data, role: 'related' },
      { onSuccess: onDone },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="border-outline-variant flex flex-col gap-2 rounded-md border p-3"
    >
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Organization</span>
        <select
          value={organizationId ?? ''}
          onChange={(event) => {
            setOrganizationId(OrganizationId.parse(event.target.value));
          }}
          className="border-outline-variant text-body rounded-md border bg-transparent px-2 py-1.5"
        >
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Task ID</span>
        <Input
          value={taskIdInput}
          onChange={(event) => {
            setTaskIdInput(event.target.value);
          }}
          placeholder="01ARZ3NDEKTSV4RRFFQ69G5FAV"
        />
        {taskIdInput.length > 0 && !parsedTaskId.success ? (
          <span className="text-destructive text-xs">Enter a valid task id.</span>
        ) : null}
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!organizationId || !parsedTaskId.success || link.isPending}
        >
          {link.isPending ? 'Linking…' : 'Link task'}
        </Button>
      </div>
      {link.isError ? (
        <p className="text-destructive text-xs">
          {userErrorMessage(link.error, 'Could not update the calendar item.')}
        </p>
      ) : null}
    </form>
  );
}

/** Props for {@link LinkedTasksSection}. */
interface LinkedTasksSectionProps {
  /** The calendar item whose linked tasks the section renders. */
  item: CalendarItemOut;
  /** Navigate to a linked task's detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
}

/** The linked-tasks section: the grouped stack plus create/link actions. */
function LinkedTasksSection({ item, onOpenTask }: LinkedTasksSectionProps): JSX.Element {
  const [showCreate, setShowCreate] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const grouped = ROLE_ORDER.map((role) => ({
    role,
    links: item.linkedTasks.filter((link) => link.role === role),
  })).filter((group) => group.links.length > 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-on-surface text-sm font-semibold">Linked tasks</h3>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowCreate((v) => !v);
              setShowLink(false);
            }}
          >
            <Plus /> New
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowLink((v) => !v);
              setShowCreate(false);
            }}
          >
            <LinkIcon /> Link
          </Button>
        </div>
      </div>

      {grouped.length === 0 ? (
        <p className="text-on-surface-variant text-xs">No linked tasks yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map(({ role, links }) => (
            <div key={role} className="flex flex-col gap-1.5">
              <p className="text-on-surface-variant text-[11px] font-medium tracking-wide uppercase">
                {ROLE_LABEL[role]}
              </p>
              <div className="flex flex-col gap-1.5">
                {links.map((link) => (
                  <LinkedTaskRow
                    key={link.taskId}
                    itemId={item.id}
                    link={link}
                    onOpenTask={onOpenTask}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate ? (
        <CreateTaskForm
          itemId={item.id}
          fallbackTitle={item.title}
          onDone={() => {
            setShowCreate(false);
          }}
        />
      ) : null}
      {showLink ? (
        <LinkTaskForm
          itemId={item.id}
          onDone={() => {
            setShowLink(false);
          }}
        />
      ) : null}
    </section>
  );
}

/** Props for {@link DeleteBlockAction}. */
interface DeleteBlockActionProps {
  /** The calendar item to (conditionally) offer deletion for. */
  item: CalendarItemOut;
  /** Called once the block is deleted. */
  onDeleted: () => void;
}

/** Delete-block action for native blocks (behind a confirm dialog); renders nothing otherwise. */
function DeleteBlockAction({ item, onDeleted }: DeleteBlockActionProps): JSX.Element | null {
  const remove = useDeleteCalendarItem(item.id);
  const [confirming, setConfirming] = useState(false);
  if (item.kind !== 'native_block' || !item.permissions.canDelete) return null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => {
          setConfirming(true);
        }}
      >
        <Trash2 /> Delete block
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{item.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This removes the block from your calendar. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className={CANCEL_CLASS}>Cancel</DialogClose>
            <button
              type="button"
              className={DESTRUCTIVE_CONFIRM_CLASS}
              onClick={() => {
                remove.mutate(undefined);
                setConfirming(false);
                onDeleted();
              }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Props for {@link CalendarItemWorkspace}. */
interface CalendarItemWorkspaceProps {
  /** The loaded calendar item to render. */
  item: CalendarItemOut;
  /** The item's owning layer, for color/title/provider context. */
  layer?: CalendarLayerOut;
  /** Close the drawer (used after a delete). */
  onClose: () => void;
  /** Navigate to a linked task's detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
}

/** The workspace body for one loaded item — remounted (via `key`) whenever the item id changes. */
function CalendarItemWorkspace({
  item,
  layer,
  onClose,
  onOpenTask,
}: CalendarItemWorkspaceProps): JSX.Element {
  const KindIcon = CALENDAR_ITEM_KIND_ICON[item.kind];
  const attendeeCount = item.attendees.length;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 [&_svg]:size-5"
            style={{ color: layer?.color ?? undefined }}
          >
            <KindIcon />
          </span>
          <SheetTitle className="text-on-surface min-w-0 flex-1 text-base font-semibold">
            {item.title}
          </SheetTitle>
        </div>
        <p className="text-on-surface-variant text-sm">{itemTimeLabel(item)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {layer ? (
            <Badge variant="outline" className="gap-1.5 font-normal">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
              />
              {layer.title}
            </Badge>
          ) : null}
          <Badge variant="secondary" className="font-normal">
            {CALENDAR_ITEM_KIND_LABEL[item.kind]}
          </Badge>
          {item.htmlLink ? (
            <a
              href={item.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="text-primary text-xs hover:underline"
            >
              Open in provider
            </a>
          ) : null}
        </div>
      </header>

      <SyncStatusSection item={item} />

      <section className="flex flex-col gap-2">
        <h3 className="text-on-surface text-sm font-semibold">Details</h3>
        <CoreFieldsForm item={item} />
      </section>

      <LinkedTasksSection item={item} onOpenTask={onOpenTask} />

      <section className="flex flex-col gap-1.5">
        <h3 className="text-on-surface text-sm font-semibold">Provider metadata</h3>
        <p className="text-on-surface-variant text-xs">
          {[
            layer?.provider ? `Provider: ${layer.provider}` : null,
            layer?.accessRole ? `Access: ${layer.accessRole}` : null,
            (item.organizer?.displayName ?? item.organizer?.email)
              ? `Organizer: ${item.organizer.displayName ?? item.organizer.email}`
              : null,
            attendeeCount > 0
              ? `${String(attendeeCount)} attendee${attendeeCount === 1 ? '' : 's'}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'No provider metadata.'}
        </p>
      </section>

      <div className="mt-auto flex justify-between border-t pt-3">
        <DeleteBlockAction item={item} onDeleted={onClose} />
      </div>
    </div>
  );
}

/** Props for {@link CalendarItemDrawer}. */
export interface CalendarItemDrawerProps {
  /** The calendar item id to show, or `null` to keep the drawer closed. */
  itemId: string | null;
  /** Close the drawer. */
  onClose: () => void;
  /** Navigate to a linked task's detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
}

/** The layered-calendar item workspace drawer. */
export default function CalendarItemDrawer({
  itemId,
  onClose,
  onOpenTask,
}: CalendarItemDrawerProps): JSX.Element {
  const itemQuery = useApiQuery({
    ...calendarItemDef(itemId ?? ''),
    enabled: itemId !== null,
  });
  const layersQuery = useApiListQuery(calendarLayersDef());
  const item = itemQuery.data;
  const layer = item ? layersQuery.data?.items.find((l) => l.id === item.layerId) : undefined;

  return (
    <Sheet
      open={itemId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-[26rem]">
        {itemId === null ? (
          <SheetTitle className="sr-only">Calendar item</SheetTitle>
        ) : itemQuery.isPending ? (
          <div className="flex flex-col gap-3 p-4">
            <SheetTitle className="sr-only">Loading calendar item</SheetTitle>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : itemQuery.isError ? (
          <div className="flex flex-col gap-2 p-4">
            <SheetTitle className="sr-only">Calendar item error</SheetTitle>
            <p role="alert" className="text-destructive text-sm">
              {userErrorMessage(itemQuery.error, 'Could not update the calendar item.')}
            </p>
          </div>
        ) : item ? (
          <CalendarItemWorkspace
            key={item.id}
            item={item}
            layer={layer}
            onClose={onClose}
            onOpenTask={onOpenTask}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
