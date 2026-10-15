'use client';
import { useState, type JSX } from 'react';
import type { WorkScheduleOut } from '@docket/work/work-schedule-management';
import { InlineBanner, todayIso } from '@docket/ui/components';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
} from '@docket/ui/primitives';
import { DatePicker } from '@/components/date-picker';
import { userErrorMessage } from '@/lib/problem';
import { useWorkScheduleWrites } from './work-schedule-queries';

/** Run one explicit civil date with a stable retry key while preserving rejected input. */
export function ScheduleRunDialog({
  orgId,
  schedule,
  onClose,
}: {
  readonly orgId: string;
  readonly schedule: WorkScheduleOut;
  readonly onClose: () => void;
}): JSX.Element {
  const [date, setDate] = useState(todayIso);
  const [key] = useState(() => `manual:${crypto.randomUUID()}`);
  const [failure, setFailure] = useState<string | null>(null);
  const writes = useWorkScheduleWrites(orgId);
  const run = async (): Promise<void> => {
    setFailure(null);
    try {
      await writes.run.mutateAsync({
        id: schedule.id,
        scheduledFor: date,
        ...(schedule.revision.trigger.kind === 'manual' ||
        schedule.revision.trigger.kind === 'event'
          ? { occurrenceKey: key }
          : {}),
      });
      onClose();
    } catch (error) {
      setFailure(
        userErrorMessage(error, 'Could not run this schedule. Your date is kept. Try again.'),
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !writes.run.isPending) onClose();
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'compact' }}>
        <DialogHeader>
          <DialogTitle>Run {schedule.name}</DialogTitle>
          <DialogDescription>
            Create its work for one date. This uses the saved schedule and keeps its normal cadence.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Run date">
            <DatePicker
              ariaLabel="Manual run date"
              placeholder="Choose a date"
              value={date}
              onChange={(value) => {
                if (value) setDate(value);
              }}
              disabled={writes.run.isPending}
              triggerVariant="secondary"
            />
          </Field>
          {failure ? (
            <InlineBanner tone="critical" title="Run was not created">
              {failure}
            </InlineBanner>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={writes.run.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={writes.run.isPending || !date} onClick={() => void run()}>
            {writes.run.isPending ? 'Creating work…' : 'Create this run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
