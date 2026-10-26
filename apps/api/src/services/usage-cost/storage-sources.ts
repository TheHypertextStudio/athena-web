/**
 * `@docket/api` — where each stored byte comes from and whom it belongs to.
 *
 * @remarks
 * One declarative list per kind of storage. The meters read it, so adding a table to the ledger is a
 * single entry here. Every identifier below is a constant in this file and never user input, which is
 * what makes assembling the SQL from them safe.
 */

/** A table whose rows are attributed to the person and workspace that own them. */
export interface PostgresSource {
  /** The table name, used as the ledger dimension. The table is aliased `t` in the other fields. */
  readonly table: string;
  /** Joins that expose the columns {@link user} and {@link organization} read. */
  readonly joins?: string;
  /** SQL for the person the row belongs to; `null::text` when the row records none. */
  readonly user: string;
  /** SQL for the workspace the row belongs to; `null::text` when the row records none. */
  readonly organization: string;
}

/** A work record attributed to the workspace it lives in and to the actor who created it. */
function workRecord(table: string): PostgresSource {
  return {
    table,
    joins: 'left join actor a on a.id = t.created_by',
    user: 'a.user_id',
    organization: 't.organization_id',
  };
}

/**
 * The tables whose growth is attributed per owner.
 *
 * @remarks
 * Chosen for how fast they grow with use: provider transcripts, the activity firehose, edit history,
 * the search index, inbound mail and the work records themselves. Anything else is reported as one
 * unattributed remainder rather than guessed at.
 */
export const POSTGRES_SOURCES: readonly PostgresSource[] = [
  {
    table: 'agent_session_transcript',
    user: 't.owner_user_id',
    organization: 't.organization_id',
  },
  { table: 'event', user: 't.user_id', organization: 'null::text' },
  { table: 'inbound_event', user: 'null::text', organization: 't.organization_id' },
  {
    table: 'audit_event',
    joins: 'left join actor a on a.id = t.actor_id',
    user: 'a.user_id',
    organization: 't.organization_id',
  },
  {
    table: 'change_set_entry',
    joins: 'join change_set cs on cs.id = t.change_set_id left join actor a on a.id = cs.actor_id',
    user: 'a.user_id',
    organization: 'cs.organization_id',
  },
  { table: 'search_document', user: 't.user_id', organization: 't.organization_id' },
  { table: 'athena_inbound_message', user: 't.owner_user_id', organization: 'null::text' },
  workRecord('task'),
  workRecord('project'),
  workRecord('initiative'),
  workRecord('program'),
  workRecord('comment'),
];

/** A blob-backed table whose rows record their own size. */
export interface ObjectSource {
  /** The store name, used as the ledger dimension. */
  readonly store: string;
  /** A `SELECT` yielding `owner_user_id`, `organization_id` and `bytes` for each stored object. */
  readonly select: string;
}

/** The blob stores whose size is recorded on the row. */
export const OBJECT_SOURCES: readonly ObjectSource[] = [
  {
    store: 'attachment',
    select: `select a.user_id as owner_user_id, t.organization_id, t.byte_size::bigint as bytes
      from attachment t left join actor a on a.id = t.created_by
      where t.kind = 'file' and t.blob_key is not null and t.byte_size is not null`,
  },
  {
    store: 'document_image',
    select: `select a.user_id as owner_user_id, t.organization_id, t.byte_size::bigint as bytes
      from document_image t left join actor a on a.id = t.created_by`,
  },
  {
    store: 'discount_evidence',
    select: `select null::text as owner_user_id, d.organization_id, t.byte_size::bigint as bytes
      from billing_discount_evidence t
      join billing_discount_application d on d.id = t.application_id
      where t.deleted_at is null`,
  },
];
