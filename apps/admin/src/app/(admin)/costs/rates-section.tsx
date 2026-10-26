'use client';

import {
  Button,
  ControlGroup,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Text,
} from '@docket/ui/primitives';
import { DatePicker } from '@docket/ui/components';
import { type JSX, useState } from 'react';

import { AsyncContent, ListSkeleton, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { api } from '@/lib/api';
import {
  RESOURCE_LABEL,
  formatDay,
  formatRate,
  parseRate,
  type CostResource,
} from '@/lib/cost-format';
import { STALE, apiQueryOptions, queryKeys, useApiMutation, useApiQuery } from '@/lib/query';

/** Every metered resource, in the order the picker lists them. */
const RESOURCES = Object.keys(RESOURCE_LABEL) as CostResource[];

/** The price list. */
const ratesDef = apiQueryOptions(
  queryKeys.costRates(),
  () => api.admin.costs.rates.$get(),
  'Could not load prices.',
  { staleTime: STALE.standard },
);

/** The prices applied to recorded usage, newest first, and the control that adds one. */
export function RatesSection(): JSX.Element {
  const rates = useApiQuery(ratesDef);
  const items = rates.data?.rates ?? [];

  return (
    <AdminSection title="Prices" body="rows" action={<AddRateDialog />}>
      {rates.error ? (
        <QueryErrorBanner
          error={rates.error}
          fallback="Could not load prices."
          onRetry={() => void rates.refetch()}
        />
      ) : null}
      <AsyncContent
        loading={rates.isPending}
        empty={items.length === 0}
        skeleton={<ListSkeleton rows={3} />}
        emptyState={
          <Text as="p" token="body-small" tone="muted">
            No prices yet.
          </Text>
        }
      >
        <AdminList label="Prices">
          {items.map((rate) => (
            <AdminListRow
              key={rate.id}
              interactive={false}
              title={RESOURCE_LABEL[rate.resource]}
              subtitle={[rate.dimension, rate.note].filter(Boolean).join(' · ') || undefined}
              meta={`from ${formatDay(rate.effectiveFrom)}`}
              trailing={
                <Text as="span" token="body-small" numeric>
                  {`${formatRate(rate.microsPerMillionUnits)} per million`}
                </Text>
              }
            />
          ))}
        </AdminList>
      </AsyncContent>
    </AdminSection>
  );
}

/** What the add-price form holds while it is being filled in. */
interface RateDraft {
  readonly resource: CostResource;
  readonly dimension: string;
  readonly price: string;
  readonly from: string;
  readonly note: string;
}

/** A blank draft that starts today. */
function blankDraft(): RateDraft {
  return {
    resource: 'ai_input_tokens',
    dimension: '',
    price: '',
    from: new Date().toISOString().slice(0, 10),
    note: '',
  };
}

/** The dialog that adds a price. */
function AddRateDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const micros = parseRate(draft.price);

  const add = useApiMutation(
    () =>
      api.admin.costs.rates.$post({
        json: {
          resource: draft.resource,
          dimension: draft.dimension.trim(),
          microsPerMillionUnits: micros ?? 0,
          effectiveFrom: new Date(`${draft.from}T00:00:00.000Z`).toISOString(),
          ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        },
      }),
    'Could not add the price.',
    {
      invalidates: [queryKeys.costs()],
      onSuccess: () => {
        setOpen(false);
        setDraft(blankDraft());
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="secondary"
        controlSize="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add price
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add price</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (micros !== null) add.mutate(undefined);
          }}
        >
          <RateFields
            draft={draft}
            onChange={(patch) => {
              setDraft((current) => ({ ...current, ...patch }));
            }}
          />
          {add.error ? (
            <QueryErrorBanner error={add.error} fallback="Could not add the price." />
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={micros === null || add.isPending}>
              Add price
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The fields of the add-price form. */
function RateFields({
  draft,
  onChange,
}: {
  readonly draft: RateDraft;
  readonly onChange: (patch: Partial<RateDraft>) => void;
}): JSX.Element {
  return (
    <ControlGroup>
      <Field label="Resource">
        <Select
          value={draft.resource}
          onChange={(event) => {
            onChange({ resource: event.target.value as CostResource });
          }}
        >
          {RESOURCES.map((key) => (
            <option key={key} value={key}>
              {RESOURCE_LABEL[key]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Model, table or store">
        <Input
          value={draft.dimension}
          onChange={(event) => {
            onChange({ dimension: event.target.value });
          }}
        />
      </Field>
      <Field label="Dollars per million units">
        <Input
          inputMode="decimal"
          value={draft.price}
          onChange={(event) => {
            onChange({ price: event.target.value });
          }}
        />
      </Field>
      <Field label="Starts">
        <DatePicker
          value={draft.from}
          onChange={(value) => {
            if (value) onChange({ from: value });
          }}
          placeholder="Choose start day"
          ariaLabel="Price start day"
          triggerVariant="secondary"
          triggerClassName="w-full justify-start"
        />
      </Field>
      <Field label="Source">
        <Input
          value={draft.note}
          onChange={(event) => {
            onChange({ note: event.target.value });
          }}
        />
      </Field>
    </ControlGroup>
  );
}
