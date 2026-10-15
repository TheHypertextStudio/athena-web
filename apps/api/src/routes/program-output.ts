import type { program } from '@docket/db';
import type { ProgramOut } from '@docket/work/program-contract';
import type { z } from 'zod';
import { workTemplateIdentityOut } from '../lib/work-template-creation';
type ProgramRow = typeof program.$inferSelect;

/** Serialize a Program with its complete persisted work-template identity. */
export function programOut(p: ProgramRow): z.input<typeof ProgramOut> {
  return {
    ...workTemplateIdentityOut(p),
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    summary: p.summary,
    description: p.description,
    ownerId: p.ownerId,
    status: p.status,
    health: p.health,
    visibility: p.visibility,
    createdAt: p.createdAt.toISOString(),
  };
}
