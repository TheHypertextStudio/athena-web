import type { ProgramOut } from '@docket/work/program-contract';
import type { JSX } from 'react';
import { DetailPrintSummary } from '@/components/views/detail-print-summary';

/** Keep the Program's printed brief consistent while the interactive header gains template controls. */
export function ProgramPrintSummary({
  program,
  ownerName,
}: {
  readonly program: ProgramOut;
  readonly ownerName: string;
}): JSX.Element {
  return (
    <DetailPrintSummary
      title={program.name}
      summary={program.summary}
      description={program.description}
      properties={[
        { label: 'Status', value: program.status.replace('_', ' ') },
        { label: 'Health', value: program.health ? program.health.replace('_', ' ') : '—' },
        { label: 'Owner', value: ownerName },
        { label: 'Visibility', value: program.visibility },
      ]}
    />
  );
}
