'use client';

import { Checkbox, Skeleton, Stack, Surface, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { type ServiceControlField, useServiceControls } from './use-service-controls';

/** How one service control is presented on the settings screen. */
interface ControlPresentation {
  /** The control's name in the API's request and response body. */
  readonly field: ServiceControlField;
  /** The checkbox's DOM id, used to associate its label. */
  readonly id: string;
  /** The control's short name. */
  readonly label: string;
  /** What turning the control off stops, in plain language. */
  readonly description: string;
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
 * Both controls are on for every organization until an operator turns one off, and a change applies
 * to the next scheduled run without a redeploy. Changing a control requires a superadmin; the API's
 * 403 for a support or finance operator surfaces inline and the control stays where it was.
 */
export default function SettingsPage(): JSX.Element {
  const { controls, loading, error, reload, actionError, pending, setControl } =
    useServiceControls();

  /** The screen's body: first load, a failed load, or the controls. */
  function body(): JSX.Element {
    if (loading) {
      return (
        <Stack gap={2} aria-hidden="true">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </Stack>
      );
    }

    if (!controls) {
      return (
        <QueryErrorBanner
          error={error}
          fallback="Could not load the service controls."
          onRetry={reload}
        />
      );
    }

    return (
      <AdminSection
        title="Lovelace Lattice"
        description="Both controls are on unless someone turns them off. A change applies to every organization on the next scheduled run. Only a superadmin can change them."
      >
        <QueryErrorBanner
          error={actionError}
          fallback="Could not change this control. It is unchanged for everyone."
        />
        <Stack gap={2} aria-busy={pending !== null}>
          {CONTROLS.map((control) => (
            // The whole card is the label, so the description text is a hit target too rather
            // than the 16px box being the only way to change an instance-wide switch.
            <Surface
              key={control.field}
              as="label"
              htmlFor={control.id}
              tone="card"
              shape="medium"
              pad="roomy"
              className="cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id={control.id}
                  className="mt-1"
                  checked={controls[control.field]}
                  disabled={pending !== null}
                  onChange={(event) => {
                    setControl(control.field, event.target.checked);
                  }}
                />
                <Stack gap={1} className="min-w-0">
                  <Text as="span" token="label-large">
                    {control.label}
                  </Text>
                  <Text as="p" token="body-small" tone="muted">
                    {control.description}
                  </Text>
                  {pending === control.field ? (
                    <Text as="p" token="body-small" tone="muted" role="status">
                      Saving…
                    </Text>
                  ) : null}
                </Stack>
              </div>
            </Surface>
          ))}
        </Stack>
      </AdminSection>
    );
  }

  return (
    <AdminPage width="form">
      <AdminPageHeader
        title="Service settings"
        description="Instance-wide controls for Athena's background work."
      />
      {body()}
    </AdminPage>
  );
}
