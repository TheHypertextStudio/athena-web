'use client';

import { Card, CardContent, CardHeader, CardTitle, Checkbox } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { ErrorBanner, PageHeader, SignInAction } from '@/components/ui-bits';
import { type ServiceControlField, useServiceControls } from './use-service-controls';

/** How one service control is presented on the settings screen. */
interface ControlPresentation {
  /** The control's name in the API's request and response body. */
  field: ServiceControlField;
  /** The checkbox's DOM id, used to associate its label. */
  id: string;
  /** The control's short name. */
  label: string;
  /** What turning the control off stops, in plain language. */
  description: string;
}

/** The controls this screen renders, in display order. */
const CONTROLS: readonly ControlPresentation[] = [
  {
    field: 'latticeSubmissionsEnabled',
    id: 'lattice-submissions-enabled',
    label: 'Send work to Lattice runtimes',
    description:
      'Athena hands new background work to the Lovelace Lattice runtime a person has connected. Turn this off to stop sending new work; anything already sent keeps running.',
  },
  {
    field: 'latticePollingEnabled',
    id: 'lattice-polling-enabled',
    label: 'Collect results from Lattice runtimes',
    description:
      'Athena checks on work it already sent and records the results. Turn this off to leave that work waiting until you turn it back on.',
  },
];

/**
 * The service settings screen: the instance-wide switches for Athena's Lattice work.
 *
 * @remarks
 * A Client Component reading `GET /admin/service-controls` at runtime. Both controls are on for
 * every organization until an operator turns one off, and a change applies to the next scheduled
 * run without a redeploy. Changing a control requires a superadmin; the API's 403 for a support or
 * finance operator surfaces inline and the control stays where it was.
 */
export default function SettingsPage(): JSX.Element {
  const { controls, loading, error, authFailed, actionError, pending, setControl } =
    useServiceControls();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="Service settings"
        description="Instance-wide controls for Athena's background work."
      />

      {controls ? (
        <>
          <ErrorBanner message={actionError} />
          <Card>
            <CardHeader>
              <CardTitle className="text-body-medium">Lovelace Lattice</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-on-surface-variant text-body-small">
                Both controls are on unless someone turns them off. A change applies to every
                organization on the next scheduled run. Only a superadmin can change them.
              </p>
              <div className="flex flex-col gap-3" aria-busy={pending !== null}>
                {CONTROLS.map((control) => (
                  <div
                    key={control.field}
                    className="border-outline-variant bg-surface-container-low flex items-start gap-3 rounded-lg border p-4"
                  >
                    <Checkbox
                      id={control.id}
                      className="mt-1"
                      checked={controls[control.field]}
                      disabled={pending !== null}
                      onChange={(event) => {
                        setControl(control.field, event.target.checked);
                      }}
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={control.id} className="text-on-surface text-label-large">
                        {control.label}
                      </label>
                      <p className="text-on-surface-variant text-body-small">
                        {control.description}
                      </p>
                      {pending === control.field ? (
                        <p className="text-on-surface-variant text-body-small" role="status">
                          Saving…
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      ) : loading ? (
        <div
          className="border-outline-variant bg-surface-container-low h-40 animate-pulse rounded-lg border"
          aria-hidden="true"
        />
      ) : (
        <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />
      )}
    </div>
  );
}
