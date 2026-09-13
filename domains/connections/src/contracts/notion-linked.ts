/**
 * `domain packages` — contracts for Notion databases linked to an integration.
 *
 * @remarks
 * A linked database is an existing Notion database a person connected, as opposed to one Docket
 * builds (see `../notion/mirror-contract`). These schemas describe what the sync stores about it on
 * the integration's connector config.
 */
import { z } from 'zod';

/** How confidently Docket assigned a Notion property to a linked task field. */
export const NotionMappingConfidence = z.enum(['structural', 'high', 'review']);
/** One persisted mapping decision for a linked Notion data source. */
export const NotionMappingProfileField = z.object({
  field: z.enum([
    'title',
    'completed',
    'dueDate',
    'description',
    'priority',
    'assignee',
    'project',
    'parentTask',
  ]),
  property: z.string().min(1),
  confidence: NotionMappingConfidence,
});
/** A versioned, reviewable profile for one linked Notion data source. */
export const NotionMappingProfile = z.object({
  version: z.literal(1),
  dataSourceId: z.string().min(1),
  fields: z.array(NotionMappingProfileField),
});
/** Persisted mapping profiles keyed by the Notion data-source id. */
export const NotionMappingProfiles = z.record(z.string(), NotionMappingProfile);
/** Mapping profile inferred from an existing database. */
export type NotionMappingProfile = z.infer<typeof NotionMappingProfile>;

/** Whether the last sync that wrote page content found pages Notion would not let it replace. */
export const NotionLinkedContentKept = z
  .boolean()
  .describe(
    'True when the last sync that wrote page content to linked Notion databases found pages whose content Notion would not replace, such as pages holding sub-pages. Those pages kept their content and their properties still synced. Absent until a sync has written page content.',
  );

/** Whether linked Notion databases accepted page content on the last sync that wrote some. */
export const NotionLinkedContentAccess = z
  .enum(['granted', 'missing'])
  .describe(
    'Whether the last sync that wrote page content to linked Notion databases was allowed to. `missing` means properties synced and page bodies were refused. Absent until a sync has written page content.',
  );
