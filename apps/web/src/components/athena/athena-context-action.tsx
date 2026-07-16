'use client';

import { Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { PersonalAthenaContext } from '@/lib/athena/presentation';

import { useAthenaPanel } from './athena-panel-provider';

/** Props for a contextual door into the one personal Athena dock. */
export interface AthenaContextActionProps {
  readonly label: string;
  readonly context?: PersonalAthenaContext | null;
  readonly variant?: 'ghost' | 'outline';
}

/** Open the shared personal Athena dock with the current workspace or object attached. */
export function AthenaContextAction({
  label,
  context = null,
  variant = 'outline',
}: AthenaContextActionProps): JSX.Element {
  const { openAthena } = useAthenaPanel();
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className="min-h-10"
      onClick={() => {
        openAthena(context);
      }}
    >
      <Sparkles aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}
