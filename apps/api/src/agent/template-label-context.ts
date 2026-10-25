/** Bounded explicit label examples; check access before loading any source prose. */
import {
  db,
  labelGroup,
  label,
  taskLabel,
  projectLabel,
  initiativeLabel,
  programLabel,
  type Database,
} from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { LabelTemplateSuggestionSelection } from '@docket/work/template-gallery-contract';
import { NotFoundError, ValidationError } from '../error';
import { requireTemplateTeam } from '../lib/templates/authorization';
import { workTables, type TemplateWorkRow } from '../lib/work-template-selection';
import type { LabelGroupRow, LabelRow } from '../lib/label-catalog';
import { resourceAccessKey, viewableResourceKeys } from '../permissions/resource-access';
import { requireTailoringAuthor, type TailoringCaller } from './template-tailoring-context';

const attachments = {
  task: { table: taskLabel, subject: taskLabel.taskId },
  project: { table: projectLabel, subject: projectLabel.projectId },
  initiative: { table: initiativeLabel, subject: initiativeLabel.initiativeId },
  program: { table: programLabel, subject: programLabel.programId },
};

/** Authorized prose for the private transcript and complete source facts used only for hashing. */
export interface LabelSuggestionContext {
  readonly context: {
    readonly labelGroup: { readonly id: string; readonly name: string };
    readonly label: { readonly id: string; readonly name: string };
    readonly work: readonly {
      readonly id: string;
      readonly kind: LabelTemplateSuggestionSelection['kind'];
      readonly name: string;
      readonly description: string | null;
    }[];
  };
  readonly facts: {
    readonly group: LabelGroupRow;
    readonly label: LabelRow;
    readonly rows: readonly TemplateWorkRow[];
  };
}

async function checkedLabel(
  caller: TailoringCaller,
  input: LabelTemplateSuggestionSelection,
  database: Database,
) {
  const [scope] = await database
    .select({ teamId: labelGroup.teamId })
    .from(labelGroup)
    .where(and(eq(labelGroup.id, input.labelGroupId), eq(labelGroup.organizationId, caller.orgId)))
    .for('share');
  if (!scope) throw new NotFoundError();
  if (scope.teamId) await requireTemplateTeam(caller, scope.teamId, database);
  const [group] = await database
    .select()
    .from(labelGroup)
    .where(and(eq(labelGroup.id, input.labelGroupId), eq(labelGroup.organizationId, caller.orgId)))
    .for('share');
  const [selected] = await database
    .select()
    .from(label)
    .where(
      and(
        eq(label.id, input.labelId),
        eq(label.organizationId, caller.orgId),
        eq(label.groupId, input.labelGroupId),
      ),
    )
    .for('share');
  if (!group || selected?.teamId !== group.teamId) throw new NotFoundError();
  return { group, label: selected };
}

async function checkedExamples(
  caller: TailoringCaller,
  input: LabelTemplateSuggestionSelection,
  database: Database,
) {
  const ids = [...input.workIds].sort();
  const refs = ids.map((id) => ({ organizationId: caller.orgId, kind: input.kind, id }));
  const visible = await viewableResourceKeys(caller.userId, refs, database);
  if (refs.some((ref) => !visible.has(resourceAccessKey(ref)))) throw new NotFoundError();
  const table = workTables[input.kind];
  const rows = await database
    .select()
    .from(table)
    .where(
      and(eq(table.organizationId, caller.orgId), inArray(table.id, ids), isNull(table.archivedAt)),
    )
    .orderBy(table.id)
    .for('share');
  const join = attachments[input.kind];
  const attached = await database
    .select({ id: join.subject })
    .from(join.table)
    .where(
      and(
        eq(join.table.organizationId, caller.orgId),
        eq(join.table.labelId, input.labelId),
        inArray(join.subject, ids),
      ),
    )
    .for('share');
  if (rows.length !== ids.length || attached.length !== ids.length) throw new NotFoundError();
  return rows;
}

/** Resolve only selected living rows whose actual group label and current View access still match. */
export async function loadLabelSuggestionContext(
  caller: TailoringCaller,
  raw: LabelTemplateSuggestionSelection,
  database: Database = db,
): Promise<LabelSuggestionContext> {
  const input = LabelTemplateSuggestionSelection.parse({
    labelGroupId: raw.labelGroupId,
    labelId: raw.labelId,
    kind: raw.kind,
    workIds: raw.workIds,
  });
  await requireTailoringAuthor(caller, database);
  const source = await checkedLabel(caller, input, database);
  const rows = await checkedExamples(caller, input, database);
  const context = {
    labelGroup: { id: source.group.id, name: source.group.name },
    label: { id: source.label.id, name: source.label.name },
    work: rows.map((row) => ({
      id: row.id,
      kind: input.kind,
      name: 'title' in row ? row.title : row.name,
      description: row.description,
    })),
  };
  if (JSON.stringify(context).length > 100_000)
    throw new ValidationError([{ path: ['workIds'], message: 'Choose fewer examples.' }]);
  return { context, facts: { ...source, rows } };
}
