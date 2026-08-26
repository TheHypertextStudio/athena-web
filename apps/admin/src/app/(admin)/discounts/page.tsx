'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@docket/ui/primitives';
import type { InferResponseType } from 'hono/client';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { ErrorBanner, PageHeader } from '@/components/ui-bits';
import { api } from '@/lib/api';
import { userErrorMessage, userProblemMessage } from '@/lib/problem';

type Queue = InferResponseType<(typeof api.admin)['discount-applications']['$get']>;
type Application = Queue['items'][number];
type Detail = InferResponseType<
  (typeof api.admin)['discount-applications'][':applicationId']['$get']
>;
type Preview = InferResponseType<
  (typeof api.admin)['discount-applications'][':applicationId']['preview-approval']['$post']
>;

/** Finance queue for eligibility evidence, approval effects, and final decisions. */
export default function DiscountsPage(): JSX.Element {
  const [items, setItems] = useState<readonly Application[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [selected, setSelected] = useState<Application | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const response = await api.admin['discount-applications'].$get();
      if (!response.ok) {
        setError(await userProblemMessage(response, 'Could not load discount applications.'));
        return;
      }
      const body = await response.json();
      setItems(body.items);
      setCanDecide(body.canDecide);
      setSelected((current) =>
        current ? (body.items.find((item) => item.id === current.id) ?? null) : null,
      );
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not load discount applications.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (application: Application): Promise<void> => {
    setSelected(application);
    setDetail(null);
    setPreview(null);
    setReason('');
    const response = await api.admin['discount-applications'][':applicationId'].$get({
      param: { applicationId: application.id },
    });
    if (response.ok) setDetail(await response.json());
    else setError(await userProblemMessage(response, 'Could not load the application review.'));
  };

  const previewApproval = async (): Promise<void> => {
    if (!selected) return;
    setPending('preview');
    setError(null);
    try {
      const response = await api.admin['discount-applications'][':applicationId'][
        'preview-approval'
      ].$post({ param: { applicationId: selected.id } });
      if (response.ok) setPreview(await response.json());
      else setError(await userProblemMessage(response, 'Could not preview the Stripe effects.'));
    } finally {
      setPending(null);
    }
  };

  const decide = async (action: 'approve' | 'reject' | 'request-information'): Promise<void> => {
    if (!selected || reason.trim().length === 0) return;
    setPending(action);
    setError(null);
    try {
      const response =
        action === 'approve'
          ? await api.admin['discount-applications'][':applicationId'].approve.$post({
              param: { applicationId: selected.id },
              json: { reason, confirmation: preview?.confirmation ?? '' },
            })
          : action === 'reject'
            ? await api.admin['discount-applications'][':applicationId'].reject.$post({
                param: { applicationId: selected.id },
                json: { reason },
              })
            : await api.admin['discount-applications'][':applicationId'][
                'request-information'
              ].$post({
                param: { applicationId: selected.id },
                json: { reason },
              });
      if (!response.ok) {
        setError(await userProblemMessage(response, 'Could not record the finance decision.'));
        return;
      }
      setSelected(null);
      setDetail(null);
      setPreview(null);
      setReason('');
      await load();
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not record the finance decision.'));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="Discount applications"
        description="Review eligibility and preview every Stripe effect before approval."
      />
      <ErrorBanner message={error} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-body-medium">Review queue</CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-on-surface-variant text-body-medium">
                No applications need review.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((application) => (
                  <li key={application.id}>
                    <button
                      type="button"
                      className="border-outline-variant hover:bg-surface-container-low focus-visible:ring-ring flex w-full flex-nowrap items-center justify-between gap-3 rounded-md border p-3 text-left focus-visible:ring-2 focus-visible:outline-none"
                      onClick={() => void open(application)}
                    >
                      <span className="min-w-0">
                        <span className="text-on-surface text-label-large block truncate">
                          {application.organizationName}
                        </span>
                        <span className="text-on-surface-variant text-body-small">
                          {application.programKey} · {application.status.replace('_', ' ')}
                        </span>
                      </span>
                      <span className="text-on-surface-variant text-body-small shrink-0">
                        Review
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-body-medium">Decision</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!selected ? (
              <p className="text-on-surface-variant text-body-medium">
                Select an application to inspect its evidence and history.
              </p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <p className="text-body-medium">Program: {selected.programKey}</p>
                  <p className="text-body-medium">Evidence: {selected.evidenceType ?? 'None'}</p>
                  {selected.institutionalEmail ? (
                    <p className="text-body-medium">Email: {selected.institutionalEmail}</p>
                  ) : null}
                  {selected.ein ? <p className="text-body-medium">EIN: {selected.ein}</p> : null}
                </div>
                {detail?.evidence.length ? (
                  <ul className="flex flex-col gap-2">
                    {detail.evidence.map((evidence) => (
                      <li key={evidence.id}>
                        <a
                          className="text-primary text-body-medium underline"
                          href={`/admin/discount-applications/${selected.id}/evidence/${evidence.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {evidence.fileName ?? evidence.evidenceType} (
                          {Math.ceil(evidence.byteSize / 1024)} KB)
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {detail?.events.length ? (
                  <ol className="border-outline-variant flex flex-col gap-2 border-l pl-4">
                    {detail.events.map((event) => (
                      <li key={event.id} className="text-on-surface-variant text-body-small">
                        {event.type.replaceAll('_', ' ')}
                        {event.reason ? ` — ${event.reason}` : ''}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {canDecide ? (
                  <Input
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                    }}
                    placeholder="Required finance reason"
                    aria-label="Finance decision reason"
                  />
                ) : (
                  <p className="text-on-surface-variant text-body-small">
                    Support can inspect this application. Finance records revenue decisions.
                  </p>
                )}
                {preview ? (
                  <div className="bg-surface-container-low flex flex-col gap-1 rounded-md p-3">
                    <p className="text-label-large">
                      {preview.percentOff}% through {new Date(preview.endsAt).toLocaleDateString()}
                    </p>
                    <p className="text-body-small">
                      Provider action: {preview.providerAction.replaceAll('_', ' ')}
                    </p>
                    <p className="text-body-small">
                      {preview.credit
                        ? `Credit preview: ${(preview.credit.totalAmount / 100).toLocaleString(undefined, { style: 'currency', currency: preview.credit.currency.toUpperCase() })}`
                        : 'No current-invoice credit is required.'}
                    </p>
                  </div>
                ) : null}
                {canDecide ? (
                  <div className="flex flex-nowrap gap-2 overflow-x-auto">
                    <Button
                      variant="outline"
                      onClick={() => void previewApproval()}
                      disabled={pending !== null}
                    >
                      Preview approval
                    </Button>
                    <Button
                      onClick={() => void decide('approve')}
                      disabled={!preview || pending !== null || reason.trim().length === 0}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void decide('request-information')}
                      disabled={pending !== null || reason.trim().length === 0}
                    >
                      Request information
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void decide('reject')}
                      disabled={pending !== null || reason.trim().length === 0}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
