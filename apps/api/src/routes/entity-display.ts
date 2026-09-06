/** Workspace-scoped presentation metadata for supported work entities. */
import {
  cycle,
  db,
  entityDisplay,
  initiative,
  label,
  milestone,
  program,
  project,
  task,
  team,
  workStatus,
} from '@docket/db';
import {
  defaultEntityDisplay,
  EntityDisplayOut,
  EntityDisplaySubjectType,
  EntityDisplayUpdate,
  glyphForLegacyIcon,
  legacyIconForGlyph,
} from '@docket/work/entity-display-contract';
import { isKnownEmojiHexcode } from '@docket/work/emoji-catalog';
import { isKnownMaterialSymbolName } from '@docket/work/material-symbol-catalog';
import { pageOf } from '../contracts/pagination';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { storedEntityDisplayOut } from '../lib/entity-display-output';
import { apiDoc } from '../lib/openapi-route';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson, zParam } from '../lib/validate';

const displayParam = z.object({
  subjectType: EntityDisplaySubjectType,
  subjectId: z.string(),
});

const entityDisplayWrite = EntityDisplayUpdate.superRefine((update, context) => {
  if (update.glyph?.kind === 'symbol' && !isKnownMaterialSymbolName(update.glyph.name)) {
    context.addIssue({ code: 'custom', path: ['glyph', 'name'], message: 'Unknown symbol' });
  }
  if (update.glyph?.kind === 'emoji' && !isKnownEmojiHexcode(update.glyph.hexcode)) {
    context.addIssue({ code: 'custom', path: ['glyph', 'hexcode'], message: 'Unknown emoji' });
  }
});

/**
 * The table each subject type's rows live in.
 *
 * @remarks
 * A `Record` rather than a chain of conditionals, so adding a subject type to
 * {@link EntityDisplaySubjectType} without teaching this module about it is a type error. The
 * previous shape was `subjectType === 'initiative' ? initiative : project`, which silently
 * validated every future subject type against the project table — exactly the failure adding
 * `team` would have hit.
 */
const SUBJECT_TABLE: Record<
  EntityDisplaySubjectType,
  | typeof initiative
  | typeof program
  | typeof project
  | typeof task
  | typeof cycle
  | typeof milestone
  | typeof team
  | typeof label
  | typeof workStatus
> = {
  initiative,
  program,
  project,
  task,
  cycle,
  milestone,
  team,
  label,
  workStatus,
};

async function assertSubjectInWorkspace(
  organizationId: string,
  subjectType: EntityDisplaySubjectType,
  subjectId: string,
): Promise<void> {
  const table = SUBJECT_TABLE[subjectType];
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, subjectId), eq(table.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Work item not found');
}

/** Generic entity-display router mounted at `/v1/orgs/:orgId/display`. */
const entityDisplayRouter = new Hono<AppEnv>()
  .get(
    '/:subjectType/:subjectId',
    apiDoc({
      tag: 'Display',
      summary: 'Get work-item display metadata',
      description:
        'Returns decoupled icon and semantic color metadata for a native Docket entity, falling back to stable defaults when the item has not been customized.',
      response: EntityDisplayOut,
    }),
    zParam(displayParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('param');
      await assertSubjectInWorkspace(orgId, subjectType, subjectId);
      const [row] = await db
        .select()
        .from(entityDisplay)
        .where(
          and(
            eq(entityDisplay.organizationId, orgId),
            eq(entityDisplay.subjectType, subjectType),
            eq(entityDisplay.subjectId, subjectId),
          ),
        )
        .limit(1);
      return ok(
        c,
        EntityDisplayOut,
        row
          ? storedEntityDisplayOut(subjectType, subjectId, row)
          : defaultEntityDisplay(subjectType, subjectId),
      );
    },
  )
  .put(
    '/:subjectType/:subjectId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Display',
      summary: 'Customize work-item display metadata',
      description:
        'Creates or replaces decoupled icon and semantic color metadata for a native Docket entity without changing the domain record itself.',
      capability: 'contribute',
      response: EntityDisplayOut,
    }),
    zParam(displayParam),
    zJson(entityDisplayWrite),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('param');
      const body = c.req.valid('json');
      await assertSubjectInWorkspace(orgId, subjectType, subjectId);
      const subjectDefault = defaultEntityDisplay(subjectType, subjectId);
      const glyph = body.glyph ?? glyphForLegacyIcon(body.iconKey ?? subjectDefault.iconKey);
      const iconKey = legacyIconForGlyph(glyph, subjectDefault.iconKey);
      const [row] = await db
        .insert(entityDisplay)
        .values({
          organizationId: orgId,
          subjectType,
          subjectId,
          iconKey,
          glyphKind: glyph.kind,
          glyphValue: glyph.kind === 'symbol' ? glyph.name : glyph.hexcode,
          colorKey: body.colorKey,
          customColor: body.customColor,
          ...(body.coverImage === undefined ? {} : { coverImage: body.coverImage }),
          createdBy: actorId,
        })
        .onConflictDoUpdate({
          target: [
            entityDisplay.organizationId,
            entityDisplay.subjectType,
            entityDisplay.subjectId,
          ],
          set: {
            iconKey,
            glyphKind: glyph.kind,
            glyphValue: glyph.kind === 'symbol' ? glyph.name : glyph.hexcode,
            colorKey: body.colorKey,
            customColor: body.customColor,
            // Omitted means "leave the cover alone", which is what lets the icon/color picker save
            // without having to resend an image it never loaded.
            ...(body.coverImage === undefined ? {} : { coverImage: body.coverImage }),
            updatedAt: new Date(),
          },
        })
        .returning();
      /* v8 ignore next -- @preserve insert/upsert always returns one row */
      if (!row) throw new Error('entity display upsert returned no row');
      return ok(c, EntityDisplayOut, storedEntityDisplayOut(subjectType, subjectId, row));
    },
  )
  .get(
    '/:subjectType',
    apiDoc({
      tag: 'Display',
      summary: 'List display metadata for every customized subject of one type',
      description:
        'Returns the stored display rows for one subject type across the workspace. Only **customized** subjects appear — anything absent takes the stable default for its type, which the client already knows how to compose. This exists so a grid of N teams costs one request instead of N.',
      response: pageOf(EntityDisplayOut),
    }),
    zParam(z.object({ subjectType: EntityDisplaySubjectType })),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { subjectType } = c.req.valid('param');
      const rows = await db
        .select()
        .from(entityDisplay)
        .where(
          and(eq(entityDisplay.organizationId, orgId), eq(entityDisplay.subjectType, subjectType)),
        );
      return ok(c, pageOf(EntityDisplayOut), {
        items: rows.map((row) => storedEntityDisplayOut(subjectType, row.subjectId, row)),
      });
    },
  )
  .delete(
    '/:subjectType/:subjectId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Display',
      summary: 'Reset work-item display metadata',
      description:
        'Deletes customized icon and semantic color metadata for a native Docket entity and returns the stable default presentation for that item type.',
      capability: 'contribute',
      response: EntityDisplayOut,
    }),
    zParam(displayParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('param');
      await assertSubjectInWorkspace(orgId, subjectType, subjectId);
      await db
        .delete(entityDisplay)
        .where(
          and(
            eq(entityDisplay.organizationId, orgId),
            eq(entityDisplay.subjectType, subjectType),
            eq(entityDisplay.subjectId, subjectId),
          ),
        );
      return ok(c, EntityDisplayOut, defaultEntityDisplay(subjectType, subjectId));
    },
  );

export default entityDisplayRouter;
