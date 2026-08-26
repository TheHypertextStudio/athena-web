'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Select, Skeleton, Textarea } from '@docket/ui/primitives';
import { useEffect, useState, type JSX, type SyntheticEvent } from 'react';

import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

type ProgramKey = 'student' | 'nonprofit';

interface ApplicationMutationInput {
  readonly renewal: boolean;
  readonly programKey: ProgramKey;
  readonly evidenceType:
    | 'institutional_email'
    | 'enrollment_document'
    | 'irs_registry'
    | 'determination_letter';
  readonly institutionalEmail?: string;
  readonly ein?: string;
  readonly file?: File;
}

interface SupplementMutationInput {
  readonly applicationId: string;
  readonly file?: File;
}

/** Props for the customer discount center. */
export interface BillingDiscountsSectionProps {
  /** Organization whose application and award are shown. */
  readonly orgId: string;
  /** Student eligibility applies only to personal workspaces. */
  readonly isPersonal: boolean;
  /** Whether the current member may submit billing changes. */
  readonly canManageBilling: boolean;
}

/** Format an ISO timestamp for customer-visible eligibility dates. */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

/** Format a credit amount stored in the currency's minor unit. */
function formatCredit(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

/** Render the public programs, application workflow, decision history, award, and credit. */
export function BillingDiscountsSection({
  orgId,
  isPersonal,
  canManageBilling,
}: BillingDiscountsSectionProps): JSX.Element {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const programKey: ProgramKey = isPersonal ? 'student' : 'nonprofit';
  const [evidenceType, setEvidenceType] = useState<ApplicationMutationInput['evidenceType']>(
    isPersonal ? 'institutional_email' : 'irs_registry',
  );
  const [institutionalEmail, setInstitutionalEmail] = useState(session?.user.email ?? '');
  const [ein, setEin] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [supplementFile, setSupplementFile] = useState<File | undefined>();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!institutionalEmail && session?.user.email) setInstitutionalEmail(session.user.email);
  }, [institutionalEmail, session?.user.email]);
  const discountsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.billingDiscounts(orgId),
      () => api.v1.orgs[':orgId'].billing.discounts.$get({ param: { orgId } }),
      'Could not load discount information.',
    ),
  );
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.billingDiscounts(orgId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.billing(orgId) }),
    ]);
  };
  const applicationMutation = useApiMutation<unknown, ApplicationMutationInput>({
    mutationFn: async (input) => {
      const json =
        input.programKey === 'student'
          ? {
              programKey: 'student' as const,
              evidenceType:
                input.evidenceType === 'enrollment_document'
                  ? ('enrollment_document' as const)
                  : ('institutional_email' as const),
              ...(input.institutionalEmail ? { institutionalEmail: input.institutionalEmail } : {}),
            }
          : {
              programKey: 'nonprofit' as const,
              evidenceType:
                input.evidenceType === 'determination_letter'
                  ? ('determination_letter' as const)
                  : ('irs_registry' as const),
              ein: input.ein ?? '',
            };
      const application = await unwrap(
        () =>
          input.renewal
            ? api.v1.orgs[':orgId'].billing.discounts.renew.$post({ param: { orgId }, json })
            : api.v1.orgs[':orgId'].billing.discounts.applications.$post({
                param: { orgId },
                json,
              }),
        'Could not submit the discount application.',
      );
      const evidenceFile = input.file;
      if (evidenceFile) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].billing.discounts.applications[':applicationId'].evidence.$post({
              param: { orgId, applicationId: application.id },
              form: { file: evidenceFile },
            }),
          'The application was submitted, but Docket could not upload the evidence.',
        );
      }
      return application;
    },
    onSuccess: refresh,
  });
  const withdraw = useApiMutation<unknown, string>({
    mutationFn: (applicationId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].billing.discounts.applications[':applicationId'].withdraw.$post({
            param: { orgId, applicationId },
          }),
        'Could not withdraw the application.',
      ),
    onSuccess: refresh,
  });
  const supplement = useApiMutation<unknown, SupplementMutationInput>({
    mutationFn: async ({ applicationId, file: replacementEvidence }) => {
      if (replacementEvidence) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].billing.discounts.applications[':applicationId'].evidence.$post({
              param: { orgId, applicationId },
              form: { file: replacementEvidence },
            }),
          'Could not upload the requested evidence.',
        );
      }
      return unwrap(
        () =>
          api.v1.orgs[':orgId'].billing.discounts.applications[':applicationId'].supplement.$post({
            param: { orgId, applicationId },
            json: {
              note,
              ...(programKey === 'student' && institutionalEmail ? { institutionalEmail } : {}),
              ...(programKey === 'nonprofit' && ein ? { ein } : {}),
            },
          }),
        'Could not send the requested information.',
      );
    },
    onSuccess: async () => {
      setNote('');
      setSupplementFile(undefined);
      await refresh();
    },
  });

  if (discountsQ.isPending) return <Skeleton className="h-52 max-w-2xl rounded-lg" />;
  if (discountsQ.isError) {
    return (
      <p role="alert" className="text-error text-body-medium">
        {userErrorMessage(discountsQ.error, 'Could not load discount information.')}
      </p>
    );
  }

  const summary = discountsQ.data;
  const program = summary.programs.find((candidate) => candidate.key === programKey);
  const application = summary.application;
  const award = summary.award;
  const canApply =
    !application || ['rejected', 'withdrawn', 'expired'].includes(application.status);
  const awaitingDecision =
    application && ['submitted', 'needs_information'].includes(application.status);
  const renewableAward = award && ['active', 'ending'].includes(award.status);
  const error = applicationMutation.error ?? withdraw.error ?? supplement.error;

  const submit = (event: SyntheticEvent<HTMLFormElement>, renewal = false): void => {
    event.preventDefault();
    applicationMutation.mutate({
      renewal,
      programKey,
      evidenceType,
      ...(programKey === 'student' ? { institutionalEmail } : { ein }),
      ...(file ? { file } : {}),
    });
  };

  return (
    <section className="border-outline-variant flex max-w-2xl flex-col gap-5 rounded-lg border p-5">
      <div>
        <h3 className="text-on-surface text-title-medium">Discounts</h3>
        <p className="text-on-surface-variant text-body-medium mt-1">
          {program
            ? `${program.name} provides ${program.percentOff}% off Docket Pro for ${program.reviewMonths} months after approval.`
            : 'Docket reviews eligible customer discounts before applying them.'}
        </p>
        {program ? (
          <p className="text-on-surface-variant text-body-small mt-2">{program.terms}</p>
        ) : null}
      </div>

      {award ? (
        <div className="bg-surface-container-low flex flex-col gap-1 rounded-md p-4">
          <p className="text-on-surface text-label-large">
            {award.percentOff}% discount · {award.status.replace('_', ' ')}
          </p>
          <p className="text-on-surface-variant text-body-small">
            Eligibility review: {formatDate(award.reviewAt)}
          </p>
          {summary.credit?.status === 'issued' ? (
            <p className="text-on-surface-variant text-body-small">
              Account credit issued:{' '}
              {formatCredit(summary.credit.totalAmount, summary.credit.currency)}
            </p>
          ) : null}
        </div>
      ) : null}

      {application ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-on-surface text-label-large">
              Application {application.status.replace('_', ' ')}
            </p>
            <p className="text-on-surface-variant text-body-small">
              Submitted {formatDate(application.submittedAt)}
            </p>
          </div>
          {application.informationRequest ? (
            <p className="text-on-surface-variant text-body-medium">
              Finance requested: {application.informationRequest}
            </p>
          ) : null}
          {application.decisionReason ? (
            <p className="text-on-surface-variant text-body-medium">
              Decision: {application.decisionReason}
            </p>
          ) : null}
          {application.events.length > 0 ? (
            <ol className="border-outline-variant flex flex-col gap-2 border-l pl-4">
              {application.events.map((history) => (
                <li key={history.id} className="text-on-surface-variant text-body-small">
                  {formatDate(history.createdAt)} · {history.type.replaceAll('_', ' ')}
                  {history.reason ? ` — ${history.reason}` : ''}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {canManageBilling && application?.status === 'needs_information' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            supplement.mutate({
              applicationId: application.id,
              ...(supplementFile ? { file: supplementFile } : {}),
            });
          }}
        >
          <Field
            label="Response"
            description="Explain what changed and include the requested detail."
          >
            <Textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              required
              rows={3}
            />
          </Field>
          <Field
            label="Replacement evidence"
            description="Add a PDF, PNG, or JPEG when finance requested a new document. Maximum 4 MB."
          >
            <Input
              key={`${application.id}-${supplementFile?.name ?? 'empty'}`}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => {
                setSupplementFile(event.target.files?.[0]);
              }}
            />
          </Field>
          <Button type="submit" disabled={supplement.isPending || note.trim().length === 0}>
            Send information
          </Button>
        </form>
      ) : null}

      {canManageBilling &&
      summary.applicationsEnabled &&
      (canApply || (renewableAward && !awaitingDecision)) ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            submit(event, Boolean(renewableAward));
          }}
        >
          {programKey === 'student' ? (
            <>
              <Field label="Verification method">
                <Select
                  value={evidenceType}
                  onChange={(event) => {
                    setEvidenceType(
                      event.target.value as 'institutional_email' | 'enrollment_document',
                    );
                  }}
                >
                  <option value="institutional_email">Verified institutional email</option>
                  <option value="enrollment_document">Dated enrollment document</option>
                </Select>
              </Field>
              <Field
                label="Institutional email"
                description="This must match the verified email on your Docket account."
              >
                <Input
                  type="email"
                  value={institutionalEmail}
                  onChange={(event) => {
                    setInstitutionalEmail(event.target.value);
                  }}
                  required={evidenceType === 'institutional_email'}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="EIN" description="Enter nine digits, with or without the dash.">
                <Input
                  value={ein}
                  onChange={(event) => {
                    setEin(event.target.value);
                  }}
                  required
                />
              </Field>
              <Field label="Verification method">
                <Select
                  value={evidenceType}
                  onChange={(event) => {
                    setEvidenceType(event.target.value as 'irs_registry' | 'determination_letter');
                  }}
                >
                  <option value="irs_registry">IRS registry record</option>
                  <option value="determination_letter">Determination letter</option>
                </Select>
              </Field>
            </>
          )}
          {['enrollment_document', 'determination_letter'].includes(evidenceType) ? (
            <Field label="Evidence file" description="PDF, PNG, or JPEG. Maximum 4 MB.">
              <Input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => {
                  setFile(event.target.files?.[0]);
                }}
                required
              />
            </Field>
          ) : null}
          <Button type="submit" disabled={applicationMutation.isPending}>
            {award ? 'Request renewal' : `Apply for ${program?.name ?? 'discount'}`}
          </Button>
        </form>
      ) : null}

      {canManageBilling && !summary.applicationsEnabled && !awaitingDecision ? (
        <p className="text-on-surface-variant text-body-small">
          New discount applications are not open yet. Existing applications and awards remain
          visible.
        </p>
      ) : null}

      {canManageBilling && awaitingDecision ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            withdraw.mutate(application.id);
          }}
          disabled={withdraw.isPending}
        >
          Withdraw application
        </Button>
      ) : null}
      {!canManageBilling ? (
        <p className="text-on-surface-variant text-body-small">
          A workspace administrator can submit or update a discount application.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(error, 'Could not update the discount application.')}
        </p>
      ) : null}
    </section>
  );
}
