'use client';

/**
 * `components/initiatives/plan-with-athena-action` — the initiative header's way onto the canvas.
 *
 * @remarks
 * Reopens the person's open plan on this initiative, or starts one with the real initiative as
 * its confirmed root, then hands them to the canvas with the Athena rail already holding an
 * opening line. The rail is revealed here rather than by the plan route so the seeded draft
 * survives arrival; the route only reveals when nothing has been seeded.
 */
import { Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { useAppRouter } from '@/lib/interactions/navigation';
import { useCreatePlan } from '@/lib/plan-draft/defs';

/** Props for {@link PlanWithAthenaAction}. */
export interface PlanWithAthenaActionProps {
  readonly orgId: string;
  readonly initiativeId: string;
  /** The initiative's name, for the rail's opening line and the source label. */
  readonly name: string;
  /** The workspace's word for an initiative, for the accessible name. */
  readonly noun: string;
  /** Whether the viewer may plan here; renders nothing otherwise. */
  readonly enabled: boolean;
}

/** The Plan with Athena action. */
export function PlanWithAthenaAction({
  orgId,
  initiativeId,
  name,
  noun,
  enabled,
}: PlanWithAthenaActionProps): JSX.Element | null {
  const router = useAppRouter();
  const athena = useAthenaPanel();
  const createPlan = useCreatePlan();
  if (!enabled) return null;
  return (
    <Button
      variant="ghost"
      disabled={createPlan.isPending}
      aria-label={`Plan this ${noun.toLowerCase()} with Athena`}
      data-testid="plan-with-athena"
      onClick={() => {
        void createPlan
          .mutateAsync({ organizationId: orgId as never, initiativeId: initiativeId as never })
          .then((plan) => {
            athena.openAthena(
              { workspaceId: orgId, source: { type: 'initiative', id: initiativeId, label: name } },
              `Help me plan "${name}". `,
            );
            router.push(`/orgs/${orgId}/plans/${plan.id}`);
          })
          .catch(() => undefined);
      }}
    >
      <Sparkles className="size-4" />
      Plan with Athena
    </Button>
  );
}
