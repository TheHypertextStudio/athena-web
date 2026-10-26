-- Private invocation-owned schedule structure. Authored steps are registered
-- with their immutable private invocation instead of being published as
-- organization templates. This migration changes no existing row and enables
-- no writer; alias enforcement remains a separate conditional boundary.
CREATE TABLE work_template_private_step (
  invocation_id text NOT NULL,
  step_alias text NOT NULL,
  organization_id text NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  root_key text NOT NULL,
  path text[] NOT NULL,
  kind text NOT NULL,
  parent_alias text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_step_identity PRIMARY KEY (invocation_id, step_alias, organization_id),
  CONSTRAINT private_step_invocation_fk FOREIGN KEY (invocation_id, organization_id) REFERENCES work_template_blueprint_invocation (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT private_step_parent_fk FOREIGN KEY (invocation_id, parent_alias, organization_id) REFERENCES work_template_private_step (invocation_id, step_alias, organization_id),
  CONSTRAINT private_step_kind CHECK (kind IN ('project', 'milestone', 'task')),
  CONSTRAINT private_step_path_shape CHECK (
    cardinality(path) <= 499
    AND (cardinality(path) = 0) = (parent_alias IS NULL)
  )
);

--> statement-breakpoint
ALTER TABLE work_template_private_step ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY private_step_private ON work_template_private_step AS PERMISSIVE FOR ALL TO public USING (
  organization_id = nullif(
    current_setting('docket.organization_id', true),
    ''
  )
  AND EXISTS (
    SELECT
      1
    FROM
      work_template_blueprint_invocation i
    WHERE
      i.id = work_template_private_step.invocation_id
      AND i.organization_id = work_template_private_step.organization_id
  )
)
WITH
  CHECK (
    organization_id = nullif(
      current_setting('docket.organization_id', true),
      ''
    )
    AND EXISTS (
      SELECT
        1
      FROM
        work_template_blueprint_invocation i
      WHERE
        i.id = work_template_private_step.invocation_id
        AND i.organization_id = work_template_private_step.organization_id
    )
  );

--> statement-breakpoint
CREATE FUNCTION docket_guard_private_step () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
DECLARE document jsonb; parent_kind text;
BEGIN
 IF TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'Private schedule steps are immutable' USING ERRCODE='23514',CONSTRAINT='private_step_immutable';
 END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.work_template_blueprint_invocation WHERE id=OLD.invocation_id AND organization_id=OLD.organization_id) THEN
   RAISE EXCEPTION 'Private schedule steps are retained with their invocation' USING ERRCODE='23514',CONSTRAINT='private_step_retention';
  END IF;
  RETURN OLD;
 END IF;
 SELECT manifest INTO document FROM public.work_template_blueprint_invocation WHERE id=NEW.invocation_id AND organization_id=NEW.organization_id;
 IF document IS NULL OR document->>'kind' IS DISTINCT FROM 'private_definition' OR document->>'state' IS DISTINCT FROM 'published' THEN
  RAISE EXCEPTION 'Private schedule steps require a published private invocation' USING ERRCODE='23514',CONSTRAINT='private_step_invocation';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'sourceMappings') mapping(value)
   WHERE mapping.value->>'alias'=NEW.step_alias AND mapping.value->>'kind'=NEW.kind
     AND mapping.value->'reference'->>'rootKey'=NEW.root_key AND mapping.value->'reference'->'path'=to_jsonb(NEW.path)) THEN
  RAISE EXCEPTION 'Private schedule step differs from its invocation' USING ERRCODE='23514',CONSTRAINT='private_step_mapping';
 END IF;
 -- Steps share their root's template scope, so containment is the parent alias, not the path.
 IF NEW.parent_alias IS NOT NULL THEN
  SELECT mapping.value->>'kind' INTO parent_kind FROM jsonb_array_elements(document->'sourceMappings') mapping(value)
   WHERE mapping.value->>'alias'=NEW.parent_alias AND mapping.value->'reference'->>'rootKey'=NEW.root_key AND mapping.value->>'alias'<>NEW.step_alias;
  IF parent_kind IS NULL OR NOT ((NEW.kind='milestone' AND parent_kind='project') OR (NEW.kind='task' AND parent_kind IN('project','milestone','task'))) THEN
   RAISE EXCEPTION 'Private schedule step parent differs from its invocation' USING ERRCODE='23514',CONSTRAINT='private_step_mapping';
  END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER private_step_guard
BEFORE INSERT OR UPDATE OR DELETE ON work_template_private_step FOR EACH ROW
EXECUTE FUNCTION docket_guard_private_step ();

--> statement-breakpoint
ALTER TABLE task
ADD COLUMN private_invocation_id text,
ADD COLUMN private_step_alias text;

--> statement-breakpoint
ALTER TABLE project
ADD COLUMN private_invocation_id text,
ADD COLUMN private_step_alias text;

--> statement-breakpoint
ALTER TABLE milestone
ADD COLUMN private_invocation_id text,
ADD COLUMN private_step_alias text;

--> statement-breakpoint
ALTER TABLE task
ADD CONSTRAINT task_private_origin_pair CHECK (
  (private_invocation_id IS NULL) = (private_step_alias IS NULL)
),
ADD CONSTRAINT task_private_origin_exclusive CHECK (
  private_step_alias IS NULL
  OR blueprint_step_id IS NULL
),
ADD CONSTRAINT task_private_origin_fk FOREIGN KEY (
  private_invocation_id,
  private_step_alias,
  organization_id
) REFERENCES work_template_private_step (invocation_id, step_alias, organization_id);

--> statement-breakpoint
ALTER TABLE project
ADD CONSTRAINT project_private_origin_pair CHECK (
  (private_invocation_id IS NULL) = (private_step_alias IS NULL)
),
ADD CONSTRAINT project_private_origin_exclusive CHECK (
  private_step_alias IS NULL
  OR blueprint_step_id IS NULL
),
ADD CONSTRAINT project_private_origin_fk FOREIGN KEY (
  private_invocation_id,
  private_step_alias,
  organization_id
) REFERENCES work_template_private_step (invocation_id, step_alias, organization_id);

--> statement-breakpoint
ALTER TABLE milestone
ADD CONSTRAINT milestone_private_origin_pair CHECK (
  (private_invocation_id IS NULL) = (private_step_alias IS NULL)
),
ADD CONSTRAINT milestone_private_origin_exclusive CHECK (
  private_step_alias IS NULL
  OR blueprint_step_id IS NULL
),
ADD CONSTRAINT milestone_private_origin_fk FOREIGN KEY (
  private_invocation_id,
  private_step_alias,
  organization_id
) REFERENCES work_template_private_step (invocation_id, step_alias, organization_id);

--> statement-breakpoint
CREATE INDEX task_private_origin_idx ON task (
  organization_id,
  private_invocation_id,
  private_step_alias
)
WHERE
  private_invocation_id IS NOT NULL;

--> statement-breakpoint
CREATE INDEX project_private_origin_idx ON project (
  organization_id,
  private_invocation_id,
  private_step_alias
)
WHERE
  private_invocation_id IS NOT NULL;

--> statement-breakpoint
CREATE INDEX milestone_private_origin_idx ON milestone (
  organization_id,
  private_invocation_id,
  private_step_alias
)
WHERE
  private_invocation_id IS NOT NULL;

--> statement-breakpoint
CREATE FUNCTION docket_guard_work_private_origin () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
DECLARE registered public.work_template_private_step;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.private_invocation_id,NEW.private_step_alias) IS DISTINCT FROM (OLD.private_invocation_id,OLD.private_step_alias) THEN
   RAISE EXCEPTION 'Private work origin is immutable' USING ERRCODE='23514',CONSTRAINT='work_private_origin_immutable';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.private_step_alias IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO registered FROM public.work_template_private_step
  WHERE invocation_id=NEW.private_invocation_id AND step_alias=NEW.private_step_alias AND organization_id=NEW.organization_id;
 IF registered.step_alias IS NULL OR registered.kind<>TG_TABLE_NAME OR cardinality(registered.path)=0
   OR NEW.blueprint_path IS DISTINCT FROM registered.path THEN
  RAISE EXCEPTION 'Private work origin differs from its registered step' USING ERRCODE='23514',CONSTRAINT='work_private_origin';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER task_private_origin_guard
BEFORE INSERT OR UPDATE OF private_invocation_id,
private_step_alias ON task FOR EACH ROW
EXECUTE FUNCTION docket_guard_work_private_origin ();

--> statement-breakpoint
CREATE TRIGGER project_private_origin_guard
BEFORE INSERT OR UPDATE OF private_invocation_id,
private_step_alias ON project FOR EACH ROW
EXECUTE FUNCTION docket_guard_work_private_origin ();

--> statement-breakpoint
CREATE TRIGGER milestone_private_origin_guard
BEFORE INSERT OR UPDATE OF private_invocation_id,
private_step_alias ON milestone FOR EACH ROW
EXECUTE FUNCTION docket_guard_work_private_origin ();

--> statement-breakpoint
-- Selected work now accepts a private origin, but only for the occurrence's own
-- invocation and its exact registered step, kind, path and parent selection.
CREATE OR REPLACE FUNCTION docket_validate_schedule_selected_work (
  selected_rows jsonb,
  manifest jsonb,
  root_ref jsonb,
  invocation_manifest jsonb,
  tenant text,
  occurrence_id text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE selected_row jsonb; stored_row jsonb; source_projection blueprint_step%ROWTYPE; private_projection work_template_private_step%ROWTYPE; scope_path jsonb; parent_path jsonb; parent_selection jsonb; scope_version text; occurrence_invocation text;
BEGIN
  IF coalesce(jsonb_typeof(selected_rows),'')<>'array' OR jsonb_array_length(selected_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Retained selected work exceeds its bound' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  SELECT blueprint_invocation_id INTO occurrence_invocation FROM process_occurrence WHERE id=occurrence_id AND organization_id=tenant;
  FOR selected_row IN SELECT selection_row.value FROM jsonb_array_elements(selected_rows) AS selection_row(value) LOOP
    IF coalesce(jsonb_typeof(selected_row),'')<>'object' OR NOT(selected_row ?& ARRAY['path','kind','id']) OR (select count(*) from jsonb_object_keys(selected_row))<>3 OR coalesce(selected_row->>'kind','') NOT IN('program','project','task','milestone') OR coalesce(jsonb_typeof(selected_row->'id'),'')<>'string' OR length(selected_row->>'id')=0 OR coalesce(jsonb_typeof(selected_row->'path'),'')<>'array' THEN RAISE EXCEPTION 'Malformed retained selected work' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF jsonb_array_length(selected_row->'path')>499 OR EXISTS(select 1 from jsonb_array_elements(selected_row->'path') AS path_part(value) where jsonb_typeof(path_part.value)<>'string' or trim(both '"' from path_part.value::text) !~ '^[a-z][a-z0-9_-]{0,63}$') THEN RAISE EXCEPTION 'Malformed retained selected path' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF selected_row->>'kind'<>'milestone' AND NOT EXISTS(select 1 from jsonb_array_elements(manifest) AS resolution_row(value) join template definition on definition.organization_id=tenant and definition.id=resolution_row.value->>'workTypeId' where resolution_row.value->'path'=selected_row->'path' and definition.target_type::text=selected_row->>'kind') THEN RAISE EXCEPTION 'Retained selected work has no accepted identity' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    EXECUTE format('select to_jsonb(work_row) from %I work_row where work_row.organization_id=$1 and work_row.id=$2',selected_row->>'kind') INTO stored_row USING tenant,selected_row->>'id';
    IF stored_row IS NULL THEN RAISE EXCEPTION 'Retained selected work is outside its workspace' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF selected_row->'path'='[]'::jsonb THEN
      IF selected_row->>'kind' IS DISTINCT FROM root_ref->>'kind' OR selected_row->>'id' IS DISTINCT FROM root_ref->>'id' THEN RAISE EXCEPTION 'Retained selected root changed' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest) accepted(value) WHERE accepted.value->'path'='[]'::jsonb AND accepted.value->>'workTypeId'=stored_row->>'work_type_id' AND accepted.value->>'versionId'=stored_row->>'work_type_version_id') THEN
        RAISE EXCEPTION 'Schedule root differs from its accepted publication' USING ERRCODE='23514',CONSTRAINT='schedule_actual_root_publication'; END IF;
      CONTINUE;
    END IF;
    SELECT coalesce(jsonb_agg(path_part.value ORDER BY path_part.ordinal),'[]'::jsonb) INTO scope_path FROM jsonb_array_elements(selected_row->'path') WITH ORDINALITY AS path_part(value,ordinal) WHERE path_part.ordinal<jsonb_array_length(selected_row->'path');
    IF stored_row->>'private_step_alias' IS NOT NULL THEN
      IF occurrence_invocation IS NULL OR stored_row->>'private_invocation_id' IS DISTINCT FROM occurrence_invocation THEN RAISE EXCEPTION 'Private selected work belongs to another invocation' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
      SELECT projection.* INTO private_projection FROM work_template_private_step projection WHERE projection.organization_id=tenant AND projection.invocation_id=occurrence_invocation AND projection.step_alias=stored_row->>'private_step_alias';
      IF private_projection.step_alias IS NULL OR private_projection.kind IS DISTINCT FROM selected_row->>'kind' OR private_projection.root_key IS DISTINCT FROM root_ref->>'key' OR to_jsonb(private_projection.path) IS DISTINCT FROM selected_row->'path' THEN RAISE EXCEPTION 'Private selected work has no registered step' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
      SELECT to_jsonb(parent_step.path) INTO parent_path FROM work_template_private_step parent_step WHERE parent_step.organization_id=tenant AND parent_step.invocation_id=occurrence_invocation AND parent_step.step_alias=private_projection.parent_alias;
    ELSE
      SELECT resolution_row.value->>'versionId' INTO scope_version FROM jsonb_array_elements(manifest) AS resolution_row(value) WHERE resolution_row.value->'path'=scope_path;
      SELECT projection.* INTO source_projection FROM blueprint_step projection WHERE projection.organization_id=tenant AND projection.version_id=scope_version AND projection.key=selected_row->'path'->>-1;
      IF source_projection.id IS NULL OR source_projection.kind::text IS DISTINCT FROM selected_row->>'kind' THEN RAISE EXCEPTION 'Retained selected work has no original source projection' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
      IF stored_row->>'blueprint_step_id' IS DISTINCT FROM source_projection.id OR stored_row->>'blueprint_source_version_id' IS DISTINCT FROM scope_version THEN RAISE EXCEPTION 'Retained selected work differs from its immutable origin' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
      parent_path:=CASE WHEN source_projection.parent_step_key IS NULL THEN scope_path ELSE scope_path || jsonb_build_array(source_projection.parent_step_key) END;
    END IF;
    SELECT selection_row.value INTO parent_selection FROM jsonb_array_elements(selected_rows) AS selection_row(value) WHERE selection_row.value->'path'=parent_path;
    IF parent_selection IS NULL THEN RAISE EXCEPTION 'Retained selected parent is missing' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF (to_jsonb(ARRAY(SELECT path_part.value FROM jsonb_array_elements_text(selected_row->'path') AS path_part(value))) IS DISTINCT FROM stored_row->'blueprint_path' OR stored_row->>'blueprint_parent_kind' IS DISTINCT FROM parent_selection->>'kind' OR stored_row->>'blueprint_parent_id' IS DISTINCT FROM parent_selection->>'id') THEN RAISE EXCEPTION 'Retained selected work differs from its immutable origin' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  END LOOP;
  IF EXISTS(select 1 from jsonb_array_elements(manifest) AS resolution_row(value) where not exists(select 1 from jsonb_array_elements(selected_rows) AS selection_row(value) where selection_row.value->'path'=resolution_row.value->'path')) THEN RAISE EXCEPTION 'Retained accepted identity has no selected work' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  IF NOT EXISTS(select 1 from jsonb_array_elements(selected_rows) AS selection_row(value) where selection_row.value->'path'='[]'::jsonb) OR (select count(distinct selection_row.value->'path') from jsonb_array_elements(selected_rows) AS selection_row(value))<>jsonb_array_length(selected_rows) OR (select count(distinct jsonb_build_array(selection_row.value->>'kind',selection_row.value->>'id')) from jsonb_array_elements(selected_rows) AS selection_row(value))<>jsonb_array_length(selected_rows) THEN RAISE EXCEPTION 'Retained selected paths and identities must be unique' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
END $$;

--> statement-breakpoint
-- Fixed schema verifier consumed by conditional alias enforcement. It reads the
-- catalog only; no caller input, status row or document can make it true.
CREATE FUNCTION docket_private_structure_schema_ready () RETURNS boolean LANGUAGE sql STABLE
SET
  search_path = pg_catalog,
  public AS $$
 SELECT to_regclass('public.work_template_private_step') IS NOT NULL
 AND (SELECT count(*) FROM pg_catalog.pg_constraint c
   WHERE c.contype='f' AND c.convalidated AND c.confrelid='public.work_template_private_step'::regclass
     AND c.conname IN ('task_private_origin_fk','project_private_origin_fk','milestone_private_origin_fk'))=3
 AND (SELECT count(*) FROM pg_catalog.pg_trigger t
   WHERE t.tgenabled='O' AND t.tgfoid='public.docket_guard_work_private_origin()'::regprocedure
     AND t.tgname IN ('task_private_origin_guard','project_private_origin_guard','milestone_private_origin_guard'))=3
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgenabled='O' AND t.tgname='private_step_guard' AND t.tgrelid='public.work_template_private_step'::regclass
     AND t.tgfoid='public.docket_guard_private_step()'::regprocedure)
$$;
