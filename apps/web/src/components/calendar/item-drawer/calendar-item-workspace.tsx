'use client';

/**
 * `calendar/item-drawer/calendar-item-workspace` — one calendar event, read as a moment.
 *
 * @remarks
 * This surface used to be a settings page: a header, then six stacked labelled input boxes, then
 * "Related events" and "Tasks" with a role dropdown between two buttons. Nothing was primary,
 * everything was the same weight, and an event with nothing attached still rendered seven controls
 * and two apology sentences.
 *
 * It now reads top to bottom as the arc the data already described — what you do before, the event
 * itself, what it leaves you with — and it is honest about the seam it sits on. The provider owns
 * the event's own fields; Docket owns the work around it, and that stratum is recessed onto the
 * surface ramp rather than announced with a legend.
 *
 * The composition is deliberately thin. Every region is its own module so that adding a fact to an
 * event does not mean editing the file that arranges them.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/planning/calendar-contract';
import type { WorkPlaceOut } from '@docket/planning/work-location-contract';
import { Home, Sparkles, Trash2, Workflow } from '@docket/ui/icons';
import {
  Button,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  Surface,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { PropertyPanelRow } from '@/components/property-pickers/property-panel';

import { CalendarDrawerClose } from '../calendar-drawer-close';
import { CalendarItemDuplicateSources } from '../calendar-item-duplicate-sources';
import { EventArc } from './event-arc';
import { EventCoreFields } from './event-core-fields';
import { EventMasthead } from './event-masthead';
import { GuestList } from './guest-list';
import { canDeleteCalendarItem, CalendarItemDeleteDialog } from './status-actions';
import { SyncStateNotice } from './sync-state-notice';
import { useCoreFieldDrafts } from './use-core-field-drafts';

/** Props for {@link CalendarItemWorkspace}. */
export interface CalendarItemWorkspaceProps {
  /** Hub display timezone used by editable wall-clock fields. */
  displayTimezone: string;
  /** Loaded calendar item to render. */
  item: CalendarItemOut;
  /** Owning layer, used for color, title, and provider context. */
  layer?: CalendarLayerOut | undefined;
  /** Every layer for the signed-in user, used to name the calendars a duplicate arrived on. */
  layers?: readonly CalendarLayerOut[] | undefined;
  /**
   * Copies of this event folded into the single block on the grid.
   *
   * @remarks
   * Empty for an ordinary event. Supplied so collapsing a cross-account duplicate stays
   * discoverable rather than silent — see {@link CalendarItemDuplicateSources}.
   */
  duplicates?: readonly CalendarItemOut[] | undefined;
  /** Arbitrary canonical saved places available for binding. */
  workPlaces?: readonly WorkPlaceOut[] | undefined;
  /** Close the dialog after deletion. */
  onClose: () => void;
  /** Report whether editable core fields differ from their saved values. */
  onDirtyChange: (dirty: boolean) => void;
  /** Navigate to a linked task detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
  /** Open another calendar item in the dialog. */
  onOpenItem: (itemId: string) => void;
}

/** Composed workspace body for one loaded calendar item. */
export function CalendarItemWorkspace({
  displayTimezone,
  item,
  layer,
  layers = [],
  duplicates = [],
  workPlaces = [],
  onClose,
  onDirtyChange,
  onOpenTask,
  onOpenItem,
}: CalendarItemWorkspaceProps): JSX.Element {
  const editor = useCoreFieldDrafts({ item, displayTimezone, onDirtyChange });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="gap-2">
        <EventMasthead
          item={item}
          layer={layer}
          displayTimezone={displayTimezone}
          editor={editor}
        />
        <DialogDescription className="sr-only">
          Edit this event and the work around it.
        </DialogDescription>
        <CalendarDrawerClose label="Close calendar item" onClick={onClose} />
      </DialogHeader>

      <DialogBody
        data-testid="calendar-item-dialog-scroll"
        className="flex flex-col gap-5 overscroll-contain"
      >
        <SyncStateNotice item={item} layer={layer} />
        <CalendarItemDuplicateSources duplicates={duplicates} layers={layers} />

        <div className="flex flex-col">
          <EventCoreFields item={item} displayTimezone={displayTimezone} editor={editor} />
          <GuestList item={item} />
        </div>

        <Surface tone="well" shape="medium" pad="tight">
          <PropertyPanelRow icon={<Home />} label="Saved place">
            <Select
              aria-label="Saved place"
              variant="plain"
              value={editor.workPlaceId}
              disabled={!editor.canEdit}
              onChange={(event) => {
                editor.setWorkPlace(event.target.value);
              }}
            >
              <option value="">No saved place</option>
              {workPlaces.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </Select>
          </PropertyPanelRow>
        </Surface>

        <EventArc item={item} onOpenTask={onOpenTask} onOpenItem={onOpenItem} />

        <SaveState editor={editor} />
      </DialogBody>

      <DialogFooter className="sm:justify-between">
        <EventOverflowMenu item={item} onClose={onClose} />
        <AthenaAction item={item} />
      </DialogFooter>
    </div>
  );
}

/** The quiet line that says whether the last edit reached the server. */
function SaveState({ editor }: { readonly editor: ReturnType<typeof useCoreFieldDrafts> }) {
  if (!editor.canEdit) return null;
  if (editor.saveFailed) {
    return (
      <p role="alert" className="text-error text-body-small">
        We couldn&apos;t save these changes. Please try again.
      </p>
    );
  }
  return (
    <p aria-live="polite" className="text-on-surface-variant text-body-small min-h-4">
      {editor.saving ? 'Saving…' : editor.saved ? 'Saved' : ''}
    </p>
  );
}

interface EventOverflowMenuProps {
  item: CalendarItemOut;
  onClose: () => void;
}

/**
 * The actions that are not the point of this surface.
 *
 * @remarks
 * Delete used to sit in the footer at the same visual weight as Athena, which put an irreversible
 * action and the primary one side by side. It is a menu row now, and the menu renders at all only
 * when it would hold something.
 */
function EventOverflowMenu({ item, onClose }: EventOverflowMenuProps): JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  if (!canDeleteCalendarItem(item)) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" controlSize="sm">
            <Workflow aria-hidden="true" />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width="md">
          <DropdownMenuItem
            className="text-error"
            onSelect={() => {
              setConfirming(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete event
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CalendarItemDeleteDialog
        item={item}
        open={confirming}
        onOpenChange={setConfirming}
        onDeleted={onClose}
      />
    </>
  );
}

/** The one primary action: hand the whole moment to Athena. */
function AthenaAction({ item }: { readonly item: CalendarItemOut }): JSX.Element {
  const { openAthena } = useAthenaPanel();
  return (
    <Button
      type="button"
      onClick={() => {
        const workspaceId = item.linkedTasks[0]?.organizationId;
        openAthena({
          ...(workspaceId ? { workspaceId } : {}),
          source: { type: 'calendar_item', id: item.id, label: item.title },
        });
      }}
    >
      <Sparkles aria-hidden="true" />
      Have Athena handle this
    </Button>
  );
}
