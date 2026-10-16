import { fingerprintCopyFacts } from '@docket/work/template-copy';
import { catalogChange } from '../../mcp/change-set-catalog';
import type { TemplateRow } from '../templates/model';

/** Compare the original canonical receipt fields, explicit offerings and identity consumption together. */
export function fingerprintCopiedTemplateState(
  row: TemplateRow,
  offeredTeamIds: readonly string[],
  reservationState: 'pending' | 'consumed' | 'void',
): Promise<string> {
  return fingerprintCopyFacts({
    template: catalogChange('template', null, row).after,
    offeredTeamIds: [...offeredTeamIds].sort(),
    reservationState,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
}
