'use client';

import { EmptyState } from '@docket/ui/components';
import { FileText, Tag } from '@docket/ui/icons';
import { Badge, Button, ControlGroup, Input, Stack, Surface, Text } from '@docket/ui/primitives';
import type { InferResponseType } from 'hono/client';
import { type JSX, useState } from 'react';

import { AsyncContent, ListSkeleton, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { ConfirmButton } from '@/components/confirm-button';
import { Property, PropertyList } from '@/components/admin-detail';
import { api } from '@/lib/api';
import { creditLine } from '@/lib/money';
import { discountQueueDef } from '@/lib/use-admin-queues';
import { apiQueryOptions, queryKeys, useApiMutation, useApiQuery } from '@/lib/query';

/** One application awaiting a finance decision. */
type Application = InferResponseType<
  (typeof api.admin)['discount-applications']['$get']
>['items'][number];

/** One application's evidence and decision history. */
type ApplicationDetail = InferResponseType<
  (typeof api.admin)['discount-applications'][':applicationId']['$get']
>;

/** What approving an application would do at the provider. */
type ApprovalPreview = InferResponseType<
  (typeof api.admin)['discount-applications'][':applicationId']['approval-previews']['$post']
>;

/** Bytes per kilobyte, for the evidence size readout. */
const BYTES_PER_KB = 1024;

/** One application's review detail. */
function detailDef(applicationId: string) {
  return apiQueryOptions(
    queryKeys.discount(applicationId),
    () => api.admin['discount-applications'][':applicationId'].$get({ param: { applicationId } }),
    'Could not load the application review.',
  );
}

/**
 * The finance queue for discount applications.
 *
 * @remarks
 * A decision here moves money, so the screen is built around one question at a time: pick an
 * application, read its evidence, preview exactly what approval would do at the provider, then
 * decide. Approval stays unavailable until that preview has been run — the API requires the
 * preview's confirmation token, and the button now says so rather than failing on submit.
 *
 * The four decisions used to be four identical outline buttons in a horizontally scrolling row, so
 * "Reject" looked exactly like "Preview approval". Approve is now the single primary action,
 * requesting information is subordinate to it, and rejecting an application asks first.
 */
export default function DiscountsPage(): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queue = useApiQuery(discountQueueDef);

  const items = queue.data?.items ?? [];
  const canDecide = queue.data?.canDecide ?? false;
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <AdminPage width="console">
      <AdminPageHeader title="Discount applications" />

      {queue.error ? (
        <QueryErrorBanner
          error={queue.error}
          fallback="Could not load discount applications."
          onRetry={() => void queue.refetch()}
        />
      ) : null}

      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <AdminSection title="Review queue" body="rows">
          <AsyncContent
            loading={queue.isPending}
            empty={items.length === 0}
            skeleton={<ListSkeleton rows={4} />}
            emptyState={<EmptyState icon={Tag} title="Nothing to review" frame="none" />}
          >
            <ReviewQueue
              items={items}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
              }}
            />
          </AsyncContent>
        </AdminSection>

        <AdminSection title="Decision">
          <DecisionPanel
            application={selected}
            canDecide={canDecide}
            onDecided={() => {
              setSelectedId(null);
            }}
          />
        </AdminSection>
      </div>
    </AdminPage>
  );
}

/** The applications waiting on a decision, one selectable row each. */
function ReviewQueue({
  items,
  selectedId,
  onSelect,
}: {
  readonly items: readonly Application[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <AdminList label="Applications awaiting review">
      {items.map((application) => (
        <AdminListRow
          key={application.id}
          title={application.organizationName}
          subtitle={application.programKey}
          selected={application.id === selectedId}
          trailing={<Badge variant="secondary">{application.status.replaceAll('_', ' ')}</Badge>}
          onActivate={() => {
            onSelect(application.id);
          }}
        />
      ))}
    </AdminList>
  );
}

/** The selected application's evidence, history, and decision controls. */
function DecisionPanel({
  application,
  canDecide,
  onDecided,
}: {
  readonly application: Application | null;
  readonly canDecide: boolean;
  readonly onDecided: () => void;
}): JSX.Element {
  if (!application) {
    return (
      <EmptyState
        icon={FileText}
        title="No application selected"
        body="Choose an application."
        frame="none"
      />
    );
  }

  return (
    <ApplicationReview
      key={application.id}
      application={application}
      canDecide={canDecide}
      onDecided={onDecided}
    />
  );
}

/** One application under review, with its decision controls. */
function ApplicationReview({
  application,
  canDecide,
  onDecided,
}: {
  readonly application: Application;
  readonly canDecide: boolean;
  readonly onDecided: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ApprovalPreview | null>(null);
  const detail = useApiQuery(detailDef(application.id));

  const routes = api.admin['discount-applications'][':applicationId'];
  const param = { applicationId: application.id };
  const invalidates = [queryKeys.discounts(), queryKeys.discount(application.id)];

  const runPreview = useApiMutation(
    () => routes['approval-previews'].$post({ param }),
    'Could not preview the Stripe effects.',
    {
      onSuccess: (result) => {
        setPreview(result);
      },
    },
  );

  const approve = useApiMutation(
    () =>
      routes.approvals.$post({
        param,
        json: { reason, confirmation: preview?.confirmation ?? '' },
      }),
    'Could not record the finance decision.',
    { invalidates, onSuccess: onDecided },
  );

  const requestInformation = useApiMutation(
    () => routes['information-requests'].$post({ param, json: { reason } }),
    'Could not record the finance decision.',
    { invalidates, onSuccess: onDecided },
  );

  const reject = useApiMutation(
    () => routes.rejections.$post({ param, json: { reason } }),
    'Could not record the finance decision.',
    { invalidates, onSuccess: onDecided },
  );

  const busy =
    runPreview.isPending || approve.isPending || requestInformation.isPending || reject.isPending;

  // The one failure this panel is showing: whichever of the read or the four decisions failed most
  // recently. Named here so the guard below reads as a question about the panel's state.
  const failure =
    detail.error ?? runPreview.error ?? approve.error ?? requestInformation.error ?? reject.error;

  return (
    <Stack gap={4}>
      {failure ? (
        <QueryErrorBanner error={failure} fallback="Could not complete that action." />
      ) : null}

      <ApplicationFacts application={application} />
      <Evidence detail={detail.data} applicationId={application.id} />
      <DecisionHistory detail={detail.data} />

      <DecisionControls
        application={application}
        canDecide={canDecide}
        reason={reason}
        preview={preview}
        busy={busy}
        onReasonChange={setReason}
        onPreview={() => {
          runPreview.mutate(undefined);
        }}
        onApprove={() => {
          approve.mutate(undefined);
        }}
        onRequestInformation={() => {
          requestInformation.mutate(undefined);
        }}
        onReject={() => {
          reject.mutate(undefined);
        }}
        previewing={runPreview.isPending}
        approving={approve.isPending}
        requesting={requestInformation.isPending}
        rejecting={reject.isPending}
      />
    </Stack>
  );
}

/** The finance decision: a required reason, the provider preview, and the four outcomes. */
function DecisionControls({
  application,
  canDecide,
  reason,
  preview,
  busy,
  onReasonChange,
  onPreview,
  onApprove,
  onRequestInformation,
  onReject,
  previewing,
  approving,
  requesting,
  rejecting,
}: {
  readonly application: Application;
  readonly canDecide: boolean;
  readonly reason: string;
  readonly preview: ApprovalPreview | null;
  readonly busy: boolean;
  readonly onReasonChange: (next: string) => void;
  readonly onPreview: () => void;
  readonly onApprove: () => void;
  readonly onRequestInformation: () => void;
  readonly onReject: () => void;
  readonly previewing: boolean;
  readonly approving: boolean;
  readonly requesting: boolean;
  readonly rejecting: boolean;
}): JSX.Element {
  if (!canDecide) {
    return (
      <Text as="p" token="body-small" tone="muted">
        Support can inspect this application. Finance records revenue decisions.
      </Text>
    );
  }

  const noReason = reason.trim().length === 0;

  return (
    <Stack gap={3}>
      <Input
        value={reason}
        onChange={(event) => {
          onReasonChange(event.target.value);
        }}
        placeholder="Required finance reason"
        aria-label="Finance decision reason"
      />

      <PreviewResult preview={preview} />

      <ControlGroup controlSize="md" wrap>
        <Button variant="secondary" disabled={busy} onClick={onPreview}>
          {previewing ? 'Previewing…' : 'Preview approval'}
        </Button>
        <Button disabled={busy || !preview || noReason} onClick={onApprove}>
          {approving ? 'Approving…' : 'Approve'}
        </Button>
        <Button variant="ghost" disabled={busy || noReason} onClick={onRequestInformation}>
          {requesting ? 'Requesting…' : 'Request information'}
        </Button>
        <ConfirmButton
          label={rejecting ? 'Rejecting…' : 'Reject'}
          disabled={busy || noReason}
          title="Reject this application?"
          description={`${application.organizationName} is told their application was not approved. The reason you entered is recorded and sent with the decision.`}
          confirmLabel="Reject application"
          onConfirm={onReject}
        />
      </ControlGroup>

      {preview ? null : (
        <Text as="p" token="body-small" tone="muted">
          Approval needs a preview first — it confirms exactly what changes at the provider.
        </Text>
      )}
    </Stack>
  );
}

/** What the applicant claimed and how they evidenced it. */
function ApplicationFacts({ application }: { readonly application: Application }): JSX.Element {
  return (
    <PropertyList>
      <Property label="Program" value={application.programKey} truncate />
      <Property label="Evidence" value={application.evidenceType ?? 'None'} truncate />
      {application.institutionalEmail ? (
        <Property label="Institutional email" value={application.institutionalEmail} truncate />
      ) : null}
      {application.ein ? <Property label="EIN" value={application.ein} truncate /> : null}
    </PropertyList>
  );
}

/** The files the applicant submitted, each opening in a new tab. */
function Evidence({
  detail,
  applicationId,
}: {
  readonly detail: ApplicationDetail | undefined;
  readonly applicationId: string;
}): JSX.Element | null {
  if (!detail || detail.evidence.length === 0) return null;

  return (
    <Stack gap={1} as="ul">
      {detail.evidence.map((file) => (
        <li key={file.id}>
          <Button asChild variant="ghost" controlSize="sm" className="w-full justify-start">
            <a
              href={`/admin/discount-applications/${applicationId}/evidence/${file.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <FileText aria-hidden="true" className="size-4" />
              <span className="truncate">{file.fileName ?? file.evidenceType}</span>
              <span className="text-on-surface-variant ml-auto shrink-0">
                {Math.ceil(file.byteSize / BYTES_PER_KB)} KB
              </span>
            </a>
          </Button>
        </li>
      ))}
    </Stack>
  );
}

/** What has already happened to this application. */
function DecisionHistory({
  detail,
}: {
  readonly detail: ApplicationDetail | undefined;
}): JSX.Element | null {
  if (!detail || detail.events.length === 0) return null;

  return (
    <Surface tone="card" shape="small" pad="comfortable">
      <Stack gap={1} as="ol">
        {detail.events.map((event) => (
          <li key={event.id}>
            <Text as="span" token="body-small" tone="muted">
              {event.type.replaceAll('_', ' ')}
              {event.reason ? ` — ${event.reason}` : ''}
            </Text>
          </li>
        ))}
      </Stack>
    </Surface>
  );
}

/** What approving would do at the provider, once previewed. */
function PreviewResult({
  preview,
}: {
  readonly preview: ApprovalPreview | null;
}): JSX.Element | null {
  if (!preview) return null;

  return (
    <Surface tone="card" shape="small" pad="comfortable">
      <Stack gap={1}>
        <Text as="p" token="label-large">
          {preview.percentOff}% through {new Date(preview.endsAt).toLocaleDateString()}
        </Text>
        <Text as="p" token="body-small" tone="muted">
          Provider action: {preview.providerAction.replaceAll('_', ' ')}
        </Text>
        <Text as="p" token="body-small" tone="muted">
          {creditLine(preview.credit)}
        </Text>
      </Stack>
    </Surface>
  );
}
