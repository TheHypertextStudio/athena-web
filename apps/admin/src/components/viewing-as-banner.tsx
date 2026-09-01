'use client';

import { Button, Row, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useImpersonation } from '@/components/impersonation';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { useApiMutation } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/**
 * The persistent "viewing as" banner, shown whenever an impersonation session is active.
 *
 * @remarks
 * Reads the active session from the {@link useImpersonation} context (persisted across navigation)
 * and pins a tinted bar above the content so an operator is never unaware they are impersonating.
 * Renders nothing when no impersonation is active.
 *
 * The bar separates from the content by its tint alone rather than a drawn rule — a tonal step is
 * how the design system separates regions, and here the tint is doing more work than a hairline
 * could anyway: it is the one piece of chrome whose whole job is to be noticed. The colour is
 * earned rather than decorative, carrying the same `state-started` accent the product uses for
 * "something is running right now".
 */
export function ViewingAsBanner(): JSX.Element | null {
  const { active, clear } = useImpersonation();

  const endSession = useApiMutation(
    (variables: { id: string }) =>
      api.admin.impersonations[':id'].end.$post({ param: { id: variables.id } }),
    'Could not end the impersonation session.',
    {
      onSuccess: () => {
        clear();
      },
    },
  );

  if (!active) return null;

  return (
    <Row
      role="status"
      align="center"
      justify="between"
      gap={3}
      className="bg-state-started/10 flex-wrap px-6 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {/* The emphasis is the type role's, not a weight set at the call site: `label-large`
            already carries the 500 that marks this as the line's structural fact. */}
        <Text as="p" token="label-large" className="text-state-started">
          Viewing as {active.targetLabel}
        </Text>
        <Text as="p" token="body-small" className="text-state-started/70">
          expires {formatTimestamp(active.expiresAt)}
        </Text>
        {endSession.error ? (
          <Text as="p" token="body-small" tone="error">
            {userErrorMessage(endSession.error, 'Could not end the impersonation session.')}
          </Text>
        ) : null}
      </div>
      <Button
        variant="outline"
        controlSize="sm"
        disabled={endSession.isPending}
        onClick={() => {
          endSession.mutate({ id: active.id });
        }}
      >
        {endSession.isPending ? 'Ending…' : 'End session'}
      </Button>
    </Row>
  );
}
