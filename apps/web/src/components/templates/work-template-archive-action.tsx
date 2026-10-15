'use client';
import { useState, type JSX } from 'react';
import { ConfirmDestructiveDialog } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives';
import type { WorkTemplateArchiveImpact } from '@docket/work/work-template-contract';
import { QueryLoadFailure } from '@/components/feedback';
import { useApiQuery } from '@/lib/query';
import { workTemplateArchiveImpactDef } from './work-template-archive-queries';
import { useWorkTemplateWrites } from './work-template-queries';

function ImpactPage({
  title,
  page,
  offset,
  onPage,
}: {
  title: string;
  page: WorkTemplateArchiveImpact['parents'];
  offset: number;
  onPage: (offset: number) => void;
}): JSX.Element {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-title-small">
        {title} ({page.total})
      </h3>
      {page.total === 0 ? (
        <p className="text-body-medium text-on-surface-variant">None you can access.</p>
      ) : (
        <ul className="text-body-medium list-disc space-y-1 pl-5">
          {page.items.map((item) => (
            <li key={item.id} className="break-words">
              {item.name}
            </li>
          ))}
        </ul>
      )}
      {offset > 0 || page.nextOffset !== null ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={offset === 0}
            onClick={() => {
              onPage(Math.max(0, offset - 20));
            }}
          >
            Previous {title.toLowerCase()}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={page.nextOffset === null}
            onClick={() => {
              if (page.nextOffset !== null) onPage(page.nextOffset);
            }}
          >
            More {title.toLowerCase()}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
/** Review only authorized schedule and parent references before the existing explicit archive mutation. */
export function WorkTemplateArchiveAction({
  orgId,
  id,
}: {
  orgId: string;
  id: string;
}): JSX.Element {
  const [open, setOpen] = useState(false),
    [parentOffset, setParentOffset] = useState(0),
    [scheduleOffset, setScheduleOffset] = useState(0),
    [error, setError] = useState<string | null>(null);
  const writes = useWorkTemplateWrites(orgId);
  const query = useApiQuery({
    ...workTemplateArchiveImpactDef(orgId, id, parentOffset, scheduleOffset),
    enabled: open,
  });
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setParentOffset(0);
          setScheduleOffset(0);
          setError(null);
          setOpen(true);
        }}
      >
        Archive template
      </Button>
      <ConfirmDestructiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Archive this template?"
        description="It will stop appearing for new work. Existing work, published parents, and schedules keep their saved versions."
        confirmLabel="Archive template"
        pending={writes.archive.isPending}
        confirmDisabled={query.isPending || query.isFetching || query.isError}
        error={error}
        onConfirm={() => {
          setError(null);
          writes.archive.mutate(id, {
            onSuccess: () => {
              setOpen(false);
            },
            onError: () => {
              setError('Could not archive the template. Try again.');
            },
          });
        }}
      >
        {query.isError ? (
          <QueryLoadFailure title="Archive impact" query={query} />
        ) : query.isPending ? (
          <p role="status">Reviewing template references…</p>
        ) : (
          <div className="space-y-4">
            <ImpactPage
              title="Published parents"
              page={query.data.parents}
              offset={parentOffset}
              onPage={setParentOffset}
            />
            <ImpactPage
              title="Active schedules"
              page={query.data.schedules}
              offset={scheduleOffset}
              onPage={setScheduleOffset}
            />
          </div>
        )}
      </ConfirmDestructiveDialog>
    </>
  );
}
